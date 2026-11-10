import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Mtk from 'gi://Mtk';

// Blurs what is on screen behind a shape, with plain Cogl drawing: the region is copied out of the framebuffer, scaled
// down and back up through a few small offscreens with linear filtering, and drawn back through the shape's outline.
// No shader of its own: the taps are summed with blend modes and the outline is a coverage mask.
//
//   fast     one bilinear tap a pass: cheapest, a little blocky at high strengths
//   smooth   four taps a pass (dual filter): an even, gaussian-like blur
//   frosted  smooth, with a fine grain over it

/** The blur styles, in the order the preferences list them. */
export const STYLES = ['smooth', 'fast', 'frosted'];

// Side of the quarter-disc textures that round corners and fillets in the mask.
const CURVE = 128;
// Side of the tiled grain texture, and how dark its darkest grain is (0 to 255).
const GRAIN = 128;
const GRAIN_DEPTH = 34;

let shared = null;

// Textures every blur layer uses, made once.
function resources() {
    if (shared)
        return shared;
    const ctx = Clutter.get_default_backend().get_cogl_context();
    // Coverage of a disc of radius CURVE - 1 centered on the texture's first corner, 4x4 samples a texel. The last texel
    // row and column stay clear, so clamping past the disc reads 0 (and 255 for the hollow).
    const r2 = (CURVE - 1) ** 2, ss = 4;
    const disc = new Uint8Array(CURVE * CURVE), hollow = new Uint8Array(CURVE * CURVE);
    for (let j = 0; j < CURVE; j++) {
        for (let i = 0; i < CURVE; i++) {
            let hits = 0;
            for (let b = 0; b < ss; b++) {
                const y = j + (b + 0.5) / ss;
                for (let a = 0; a < ss; a++) {
                    const x = i + (a + 0.5) / ss;
                    if (x * x + y * y <= r2)
                        hits++;
                }
            }
            const v = Math.round(255 * hits / (ss * ss));
            disc[j * CURVE + i] = v;
            hollow[j * CURVE + i] = 255 - v;
        }
    }
    // Grey grain: multiplies the blur by 1 down to 1 - GRAIN_DEPTH / 255.
    const grain = new Uint8Array(GRAIN * GRAIN * 4);
    let seed = 0x2545f491;
    for (let p = 0; p < GRAIN * GRAIN; p++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const v = 255 - ((seed >>> 0) % (GRAIN_DEPTH + 1));
        grain.set([v, v, v, 255], p * 4);
    }
    const alpha = data => Cogl.Texture2D.new_from_data(ctx, CURVE, CURVE, Cogl.PixelFormat.A_8, CURVE, data);
    shared = {
        ctx,
        disc: alpha(disc),
        hollow: alpha(hollow),
        grain: Cogl.Texture2D.new_from_data(ctx, GRAIN, GRAIN, Cogl.PixelFormat.RGBA_8888_PRE, GRAIN * 4, grain),
    };
    return shared;
}

function color(r, g, b, a) {
    const c = new Cogl.Color();
    c.init_from_4f(r, g, b, a);
    return c;
}

function layerPipeline(ctx, texture, wrap = Cogl.PipelineWrapMode.CLAMP_TO_EDGE) {
    const pipeline = Cogl.Pipeline.new(ctx);
    pipeline.set_layer_texture(0, texture);
    pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    pipeline.set_layer_wrap_mode(0, wrap);
    return pipeline;
}

/**
 * Down to how many halvings, and how far apart the taps sit in texels, for a blur of about `radius` framebuffer px.
 * Each level doubles the reach; the tap offset fills in between.
 */
export function blurPlan(radius) {
    if (!(radius > 0))
        return {levels: 0, offset: 0};
    const levels = Math.min(Math.max(Math.round(Math.log2(radius)) - 1, 1), 7);
    const offset = Math.min(Math.max(radius / 2 ** (levels + 1), 0.5), 3);
    return {levels, offset};
}

/** An offscreen texture of a set size, made again only when the size changes. */
class Target {
    constructor(ctx) {
        this._ctx = ctx;
        this.width = 0;
        this.height = 0;
        this.texture = null;
        this.fb = null;
    }

    ensure(width, height) {
        if (width === this.width && height === this.height && this.fb)
            return this;
        this.width = width;
        this.height = height;
        this.texture = Cogl.Texture2D.new_with_size(this._ctx, width, height);
        this.fb = Cogl.Offscreen.new_with_texture(this.texture);
        this.fb.allocate();
        this.fb.orthographic(0, 0, width, height, -1, 1);
        return this;
    }

    clear() {
        this.fb.clear4f(Cogl.BufferBit.COLOR, 0, 0, 0, 0);
    }
}

/**
 * Blurs the screen behind a shape. It sits right below the shape's tint in uiGroup, spans the shape's bounds, and is
 * given the shape's pieces local to those bounds.
 */
export const BlurLayer = GObject.registerClass(
class BlurLayer extends Clutter.Actor {
    _init(settings) {
        super._init({name: 'simple-gnome-shell-blur', reactive: false, visible: false});
        this._settings = settings;
        this._pieces = [];
        this._fade = 255;
        this._targets = [];
        // Per framebuffer, a copy of what is below this actor, kept between frames: {target, x, y}.
        this._caches = new Map();
        // How far the copy reaches beyond this actor, in its own units.
        this._padLocal = 0;
        this._mask = null;
        this._pipelines = null;
        this._redrawId = 0;
        this._failed = false;
        this._settingsIds = ['blur', 'blur-style', 'blur-radius'].map(key =>
            settings.connect(`changed::${key}`, () => {
                this._readSettings();
                this.queue_redraw();
            }));
        this._readSettings();
        this.connect('destroy', () => this._onDestroy());
    }

    get enabled() {
        return this._enabled;
    }

    _readSettings() {
        this._enabled = this._settings.get_boolean('blur');
        const style = this._settings.get_string('blur-style');
        this._style = STYLES.includes(style) ? style : STYLES[0];
        this._radius = this._settings.get_int('blur-radius');
    }

    /** Shows the blur behind `pieces` (composeShape()'s, local to this actor) at `fade` (0 to 255). */
    setPieces(pieces, fade) {
        this._pieces = pieces;
        this._fade = fade;
        this.queue_redraw();
    }

    // The allocation and the margin the blur reads from: a change there is in the next redraw's clip, so this paints,
    // and the whole redraw that follows takes the change in.
    vfunc_get_paint_volume(volume) {
        if (!volume.set_from_allocation(this))
            return false;
        const pad = this._padLocal || 2 * Math.max(this._radius, 0) + 4;
        const origin = new Graphene.Point3D();
        origin.init(-pad, -pad, 0);
        volume.set_origin(origin);
        volume.set_width(this.width + 2 * pad);
        volume.set_height(this.height + 2 * pad);
        return true;
    }

    vfunc_paint(paintContext) {
        if (!this._enabled || this._failed || this._fade <= 0 || !this._pieces.length)
            return;
        try {
            this._paint(paintContext);
        } catch (e) {
            // Once: this runs on every frame.
            this._failed = true;
            logError(e, '[Simple GNOME Shell] blur failed, drawing the tint alone');
        }
    }

    _paint(paintContext) {
        const fb = paintContext.get_framebuffer();
        const w = this.width, h = this.height;
        if (!(w >= 1 && h >= 1))
            return;

        // Where this actor lands in the framebuffer, through the matrices it is painted with: a monitor's view, or the
        // offscreen of a screenshot.
        const mvp = fb.get_modelview_matrix().multiply(fb.get_projection_matrix());
        const [vx, vy, vw, vh] = fb.get_viewport4fv();
        const toFb = (x, y) => {
            const v = mvp.transform_vec4(new Graphene.Vec4().init(x, y, 0, 1));
            const iw = 1 / v.get_w();
            return [vx + (v.get_x() * iw + 1) / 2 * vw, vy + (1 - v.get_y() * iw) / 2 * vh];
        };
        const [ax, ay] = toFb(0, 0), [bx, by] = toFb(w, h);
        const sx = (bx - ax) / w, sy = (by - ay) / h;
        // Rotated or mirrored: not drawn.
        if (!(sx > 0 && sy > 0))
            return;

        const radius = this._radius * Math.max(sx, sy);
        const {levels, offset} = blurPlan(radius);
        // How far the blur reaches, which the copy takes in beyond the shape.
        const pad = Math.ceil(offset * 2 ** (levels + 1)) + 2;
        // The copy's edges sit on a grid of 2^levels framebuffer px, so each halving's texels cover the same screen px
        // wherever the shape is. Copied from wherever its edge happened to be, a move of 1 px would change what every
        // texel averages, and the blur would shimmer as the shape moves or resizes.
        const step = 2 ** levels;
        this._padLocal = Math.ceil((pad + step) / Math.min(sx, sy)) + 1;
        const fw = fb.get_width(), fh = fb.get_height();
        const x0 = Math.max(Math.floor((Math.floor(ax) - pad) / step) * step, 0);
        const y0 = Math.max(Math.floor((Math.floor(ay) - pad) / step) * step, 0);
        const x1 = Math.min(Math.ceil((Math.ceil(bx) + pad) / step) * step, fw);
        const y1 = Math.min(Math.ceil((Math.ceil(by) + pad) / step) * step, fh);
        const cw = x1 - x0, ch = y1 - y0;
        if (cw < 1 || ch < 1)
            return;

        const res = resources();
        const copy = this._capture(paintContext, fb, x0, y0, cw, ch, ax, ay, sx, sy);
        const blurred = levels > 0 ? this._blur(copy, levels, offset) : copy;

        const mask = this._maskTarget().ensure(Math.max(Math.ceil(w * sx), 1), Math.max(Math.ceil(h * sy), 1));
        this._drawMask(mask, w, h);

        const p = this._finalPipeline(res, blurred.texture, mask.texture);
        const a = this._fade / 255;
        p.set_color(color(a, a, a, a));
        const coords = [(ax - x0) / cw, (ay - y0) / ch, (bx - x0) / cw, (by - y0) / ch];
        if (this._style === 'frosted')
            coords.push(0, 0, (bx - ax) / GRAIN, (by - ay) / GRAIN);
        coords.push(0, 0, 1, 1);
        fb.draw_multitextured_rectangle(p, 0, 0, w, h, coords, coords.length);
    }

    // Copies what is below this actor, framebuffer rect (x0, y0, cw, ch), into a texture. Only a redraw of all of that
    // rect can be read back: on a partial redraw, what the framebuffer holds even inside the clip is not what a whole
    // redraw puts there (whatever is drawn above, such as a dock icon that moves, shows through), and blurring it in
    // made the clip a square that twitched. So each onscreen framebuffer keeps the copy of its last whole redraw. A
    // partial redraw blurs that copy, which gives what the rest of the screen already shows, and asks for a whole
    // redraw on the next frame, which takes in whatever changed below.
    _capture(paintContext, fb, x0, y0, cw, ch, ax, ay, sx, sy) {
        const clip = paintContext.get_redraw_clip();
        if (!clip) {
            // A whole paint, such as a screenshot's: all of it is fresh.
            const copy = this._target(0).ensure(cw, ch);
            fb.blit(copy.fb, x0, y0, 0, 0, cw, ch);
            return copy;
        }
        let cache = this._caches.get(fb);
        if (!cache) {
            // Framebuffers come and go with monitors: keep a few.
            if (this._caches.size >= 4)
                this._caches.delete(this._caches.keys().next().value);
            cache = {target: new Target(resources().ctx), x: NaN, y: NaN};
            this._caches.set(fb, cache);
        }
        const copy = cache.target;
        const same = copy.fb && copy.width === cw && copy.height === ch && cache.x === x0 && cache.y === y0;
        copy.ensure(cw, ch);

        // Whether the clip takes in all of the rect, less a pixel of rounding at each edge.
        const [stageX, stageY] = this.get_transformed_position();
        const left = stageX - (ax - x0) / sx, top = stageY - (ay - y0) / sy;
        const inner = new Mtk.Rectangle({
            x: Math.ceil(left) + 1, y: Math.ceil(top) + 1,
            width: Math.floor(cw / sx) - 2, height: Math.floor(ch / sy) - 2,
        });
        const whole = inner.width < 1 || inner.height < 1 ||
            clip.contains_rectangle(inner) === Mtk.RegionOverlap.IN;

        if (whole || !same) {
            // Moved or resized on a partial redraw, there is no copy to go on: this one has stale pixels in it.
            fb.blit(copy.fb, x0, y0, 0, 0, cw, ch);
            cache.x = x0;
            cache.y = y0;
        }
        if (!whole)
            this._queueWholeRedraw();
        return copy;
    }

    // Halves the copy `levels` times and doubles it back up, through targets of their own: a texture is never drawn
    // into after it was read from, which Cogl's batching would reorder. Returns the target holding the blur.
    _blur(copy, levels, offset) {
        const down = [copy];
        for (let i = 1; i <= levels; i++) {
            const prev = down[i - 1];
            if (prev.width < 2 && prev.height < 2)
                break;
            down.push(this._target(i).ensure(Math.max(Math.ceil(prev.width / 2), 1),
                Math.max(Math.ceil(prev.height / 2), 1)));
        }
        for (let i = 1; i < down.length; i++)
            this._pass(down[i - 1], down[i], offset);
        let src = down[down.length - 1];
        for (let i = down.length - 2; i >= 0; i--) {
            const dst = this._upTarget(i).ensure(down[i].width, down[i].height);
            this._pass(src, dst, offset);
            src = dst;
        }
        return src;
    }

    // Draws `src` scaled into all of `dst`: one bilinear tap, or four at the diagonals `offset` texels away, summed.
    _pass(src, dst, offset) {
        const {ctx} = resources();
        dst.clear();
        if (this._style === 'fast') {
            const p = layerPipeline(ctx, src.texture);
            dst.fb.draw_textured_rectangle(p, 0, 0, dst.width, dst.height, 0, 0, 1, 1);
            dst.fb.flush();
            return;
        }
        const p = layerPipeline(ctx, src.texture);
        p.set_color(color(0.25, 0.25, 0.25, 0.25));
        p.set_blend('RGBA = ADD(SRC_COLOR, DST_COLOR)');
        const du = offset / src.width, dv = offset / src.height;
        const rects = [];
        for (const [kx, ky] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
            rects.push(0, 0, dst.width, dst.height, kx * du, ky * dv, 1 + kx * du, 1 + ky * dv);
        dst.fb.draw_textured_rectangles(p, rects, 4);
        dst.fb.flush();
    }

    // The shape's coverage, local to this actor, in the mask's alpha.
    _drawMask(mask, w, h) {
        const {ctx, disc, hollow} = resources();
        if (!this._pipelines) {
            const solid = Cogl.Pipeline.new(ctx);
            solid.set_color(color(1, 1, 1, 1));
            this._pipelines = {solid, disc: layerPipeline(ctx, disc), hollow: layerPipeline(ctx, hollow)};
        }
        const {solid, disc: discP, hollow: hollowP} = this._pipelines;
        mask.clear();
        // Drawn in this actor's units, whatever the mask's resolution.
        mask.fb.orthographic(0, 0, w, h, -1, 1);
        const solids = [];
        const box = (x1, y1, x2, y2) => {
            if (x2 > x1 && y2 > y1)
                solids.push(x1, y1, x2, y2);
        };
        // Texture coordinate at a distance of one radius from the disc's center.
        const k = (CURVE - 1) / CURVE;
        for (const piece of this._pieces) {
            const {x, y, w: pw, h: ph} = piece;
            const x2 = x + pw, y2 = y + ph;
            if (piece.type === 'fillet') {
                const r = Math.max(piece.radius, 1);
                const [hx, hy] = piece.hollow;
                const cx = hx ? x2 : x, cy = hy ? y2 : y;
                mask.fb.draw_textured_rectangle(hollowP, x, y, x2, y2,
                    Math.abs(x - cx) / r * k, Math.abs(y - cy) / r * k,
                    Math.abs(x2 - cx) / r * k, Math.abs(y2 - cy) / r * k);
                continue;
            }
            const lim = Math.min(pw, ph) / 2;
            const [tl, tr, br, bl] = piece.radii.map(r => Math.min(Math.max(r, 0), lim));
            const ym = y + ph / 2;
            // The rect less its four corner squares, in overlapping boxes: top half, then bottom half.
            box(x + tl, y, x2 - tr, ym);
            box(x, y + tl, x2 - tr, ym);
            box(x + tl, y + tr, x2, ym);
            box(x + bl, ym, x2 - br, y2);
            box(x, ym, x2 - br, y2 - bl);
            box(x + bl, ym, x2, y2 - br);
            if (tl > 0)
                mask.fb.draw_textured_rectangle(discP, x, y, x + tl, y + tl, k, k, 0, 0);
            if (tr > 0)
                mask.fb.draw_textured_rectangle(discP, x2 - tr, y, x2, y + tr, 0, k, k, 0);
            if (br > 0)
                mask.fb.draw_textured_rectangle(discP, x2 - br, y2 - br, x2, y2, 0, 0, k, k);
            if (bl > 0)
                mask.fb.draw_textured_rectangle(discP, x, y2 - bl, x + bl, y2, k, 0, 0, k);
        }
        if (solids.length)
            mask.fb.draw_rectangles(solid, solids, solids.length / 4);
        mask.fb.flush();
    }

    // The blurred copy, grained if frosted, through the mask, at the fade.
    _finalPipeline(res, copy, mask) {
        const p = layerPipeline(res.ctx, copy);
        let layer = 1;
        if (this._style === 'frosted') {
            p.set_layer_texture(layer, res.grain);
            p.set_layer_filters(layer, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
            p.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.REPEAT);
            p.set_layer_combine(layer, 'RGB = MODULATE(PREVIOUS, TEXTURE) A = REPLACE(PREVIOUS)');
            layer++;
        }
        p.set_layer_texture(layer, mask);
        p.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        p.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        p.set_layer_combine(layer, 'RGBA = MODULATE(PREVIOUS, TEXTURE[A])');
        return p;
    }

    _queueWholeRedraw() {
        if (this._redrawId)
            return;
        this._redrawId = GLib.idle_add(GLib.PRIORITY_HIGH, () => {
            this._redrawId = 0;
            this.queue_redraw();
            return GLib.SOURCE_REMOVE;
        });
    }

    _target(i) {
        this._targets[i] ??= new Target(resources().ctx);
        return this._targets[i];
    }

    _upTarget(i) {
        this._ups ??= [];
        this._ups[i] ??= new Target(resources().ctx);
        return this._ups[i];
    }

    _maskTarget() {
        this._mask ??= new Target(resources().ctx);
        return this._mask;
    }

    _onDestroy() {
        if (this._redrawId)
            GLib.source_remove(this._redrawId);
        this._redrawId = 0;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._targets = [];
        this._caches.clear();
        this._ups = [];
        this._mask = null;
        this._pipelines = null;
    }
});
