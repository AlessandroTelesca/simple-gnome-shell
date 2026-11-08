import GLib from 'gi://GLib';
import St from 'gi://St';

import {addTicker, removeTicker, isActorValid} from './frames.js';
import {Spring} from './spring.js';

// The bars that are drawn now, which what opens from their buttons can grow out of.
const liveBars = new Set();

export function addBar(bar) {
    liveBars.add(bar);
}

export function removeBar(bar) {
    liveBars.delete(bar);
}

/** The bar whose button `source` is, while what opens from it grows out of the bar by `key`, or null. */
export function barFrom(source, key) {
    if (!source)
        return null;
    for (const bar of liveBars) {
        if (bar.growsFrom(source, key))
            return bar;
    }
    return null;
}

/** The top bar on monitor `index`, or null. */
export function topBarOnMonitor(index) {
    for (const bar of liveBars) {
        if (bar.isTopBar && bar.monitorIndex === index)
            return bar;
    }
    return null;
}

// How far the content's shape starts inside the bar's, so no seam shows where they meet.
const OVERLAP = 4;
// The springs, [response (s), damping fraction]. Opening, the shape spreads along the bar under the button quickly and
// nearly without overshoot, while it flows down on a softer spring that swings past the content and settles back.
// Closing, both run back without a swing.
const OPEN_SPREAD = [0.3, 0.78];
const OPEN_DROP = [0.46, 0.62];
const CLOSE = [0.26, 1];
// Frames to wait for content that is not laid out yet before it opens without the growth.
const WAIT_FRAMES = 30;
// The content comes up through the shape between these points of its drop, and slides this far (px) as it does.
const CONTENT_FROM = 0.3;
const CONTENT_TO = 0.9;
const CONTENT_SLIDE = 14;
// Closing ends here rather than waiting out the spring's tail, while the hidden content still takes the pointer.
const CLOSED_BELOW = 0.02;

const lerp = (from, to, p) => from + (to - from) * p;

class Spring2 extends Spring {
    constructor(params) {
        super(params[0], params[1]);
    }

    set(params) {
        this.setParams(params[0], params[1]);
    }
}

function allocatedSize(actor) {
    const box = actor.get_allocation_box();
    return [box.get_width(), box.get_height()];
}

/**
 * Content that grows out of a bar instead of floating beside it. The bar draws the content's background as part of its
 * shape. Opening, the shape spreads out of the bar under the button and flows out into the content, which comes up
 * through it; closing runs back.
 *
 * The host provides key, content(), shown(), scale(), source(), button() (a rect on the stage), radius(),
 * hold(opening), closed(), and optionally limit(), the lowest stage y the shape may reach while it grows downwards.
 */
export class BarGrowth {
    constructor(host) {
        this._host = host;
        this._bar = null;
        this._spread = new Spring2(OPEN_SPREAD);
        this._drop = new Spring2(OPEN_DROP);
        this._content = null;
        this._restY = 0;
        this._slide = 0;
        this._opening = false;
        this._tickId = 0;
        this._lastUs = 0;
        this._waitFrames = 0;
        this._button = null;
        this._lastBody = null;
    }

    /** Whether the bar draws the content now, as it grows or at rest. */
    get holding() {
        return this._bar !== null;
    }

    /** Whether what it holds would grow out of a bar now. */
    get growsOutOfBar() {
        return barFrom(this._host.source(), this._host.key) !== null;
    }

    /** Whether it is opening or open, rather than closing. */
    get opening() {
        return this._opening;
    }

    /** Whether the springs are running. */
    get animating() {
        return this._tickId !== 0;
    }

    /** Starts the content growing out of the bar (`open`) or back into it. False when there is no bar to grow from. */
    start(open) {
        const bar = barFrom(this._host.source(), this._host.key) ?? (open ? null : this._bar);
        const content = this._host.content();
        if (!bar || !content) {
            this.release();
            return false;
        }
        if (this._bar && this._bar !== bar)
            this._bar.setMenuGrowth(this, null, 0);
        this._bar = bar;
        this._opening = open;
        // A reversal midway keeps the springs' values and velocities, so the shape turns round smoothly.
        this._spread.set(open ? OPEN_SPREAD : CLOSE);
        this._drop.set(open ? OPEN_DROP : CLOSE);
        this._spread.target = this._drop.target = open ? 1 : 0;
        this._waitFrames = 0;
        // The content keeps its size; a scale left behind would shrink it and the shape.
        content.remove_all_transitions();
        content.set_scale(1, 1);
        // New content (a banner coming while the last one's shape runs back in) takes over the shape where it is.
        if (this._content !== content) {
            if (this._content)
                this._resetContent();
            this._content = content;
            this._slide = 0;
            this._restY = content.translation_y;
            if (open)
                content.opacity = 0;
        } else if (!this._tickId) {
            this._restY = content.translation_y - this._slide;
            if (open)
                content.opacity = 0;
        }
        this._startTicking();
        return true;
    }

    /** Keeps the bar drawing the content at rest, for a per-frame sync. True while it does. */
    holdAtRest() {
        if (this._tickId)
            return true;
        const content = this._host.content();
        const bar = content && this._host.shown() ? barFrom(this._host.source(), this._host.key) : null;
        if (bar !== this._bar || content !== this._content)
            this.release();
        if (!bar || !content)
            return false;
        this._bar = bar;
        this._content = content;
        this._opening = true;
        this._spread.jump(1);
        this._drop.jump(1);
        const body = this._body();
        if (body)
            this._place(body, 1);
        return true;
    }

    /** Runs the shape back into the bar from where it is, without the content, which went away. */
    retract() {
        if (!this._bar || !this._lastBody) {
            this.release();
            return;
        }
        this._resetContent();
        this._opening = false;
        this._spread.set(CLOSE);
        this._drop.set(CLOSE);
        this._spread.target = this._drop.target = 0;
        this._startTicking();
    }

    /** Takes the shape back into the bar at once and leaves the content as the shell expects it. */
    release() {
        if (this._tickId) {
            removeTicker(this._tickId);
            this._tickId = 0;
        }
        if (!this._bar)
            return;
        this._bar.setMenuGrowth(this, null, 0);
        this._bar = null;
        this._lastBody = null;
        this._spread.jump(0);
        this._drop.jump(0);
        this._resetContent();
    }

    _startTicking() {
        if (this._tickId)
            return;
        this._lastUs = 0;
        this._tickId = addTicker(() => this._step());
    }

    _resetContent() {
        const content = this._content;
        this._content = null;
        if (!isActorValid(content)) {
            this._slide = 0;
            return;
        }
        if (this._slide) {
            content.translation_y = this._restY;
            this._slide = 0;
        }
        content.remove_clip();
        content.opacity = 255;
    }

    _setSlide(slide) {
        this._slide = slide;
        this._content.translation_y = this._restY + slide / this._host.scale();
    }

    _step() {
        const host = this._host;
        const bar = this._bar;
        // Without its content only a retract goes on, from the shape's last outline.
        const content = isActorValid(this._content) ? this._content : null;
        if (!bar || (!content && this._opening)) {
            this._tickId = 0;
            this.release();
            return false;
        }
        if (content)
            host.hold(this._opening);
        this._button = host.button() ?? this._button;
        const body = content ? this._body() : this._lastBody;
        if (!body || !this._button) {
            if (++this._waitFrames < WAIT_FRAMES)
                return true;
            this._tickId = 0;
            this.release();
            return false;
        }
        const now = GLib.get_monotonic_time();
        const elapsedMs = this._lastUs ? (now - this._lastUs) / 1000 : 1000 / 60;
        this._lastUs = now;
        // Both stepped every frame: && would skip the second once the first settles.
        const spreadSettled = this._spread.update(elapsedMs);
        const dropSettled = this._drop.update(elapsedMs);
        const spread = this._spread.value, drop = this._drop.value;
        const [bx, , bw] = this._button;
        const left = lerp(bx, body[0], spread);
        const right = lerp(bx + bw, body[0] + body[2], spread);
        // Down out of a top bar to the content's bottom, or up out of a dock to its top.
        if (bar.growDirection > 0) {
            // The swing past the content stops at the host's limit, if it has one.
            const reach = Math.min(lerp(bar.glassEdge(), body[1] + body[3], drop), host.limit?.() ?? Infinity);
            this._place([left, body[1], right - left, reach - body[1]], drop);
        } else {
            const reach = lerp(bar.glassEdge(), body[1], drop);
            this._place([left, reach, right - left, body[1] + body[3] - reach], drop);
        }
        const done = this._opening
            ? spreadSettled && dropSettled
            : Math.max(spread, drop) <= CLOSED_BELOW;
        if (!done)
            return true;
        this._tickId = 0;
        if (this._opening) {
            this._setSlide(0);
            content.remove_clip();
            content.opacity = 255;
        } else {
            this.release();
            if (content)
                host.closed();
        }
        return false;
    }

    // The content's body where it rests, [x, y, w, h] on the stage, or null before it is laid out.
    _body() {
        const content = this._content;
        if (!content || !this._host.shown())
            return null;
        // The allocation: a restyle leaves a relayout pending, during which the size getters re-measure.
        const [w, h] = allocatedSize(content);
        const [x, slidY] = content.get_transformed_position();
        const y = slidY - this._slide;
        const k = this._host.scale() * (content.get_scale()[0] || 1);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 1) || !(h > 1))
            return null;
        return [x, y, w * k, h * k];
    }

    // Hands the bar the shape to `body`'s far end and shows the content inside it, coming in with the drop `p`.
    _place(body, p) {
        const bar = this._bar;
        const content = this._content;
        if (content)
            this._lastBody = body;
        const dir = bar.growDirection;
        const near = bar.glassEdge() - OVERLAP * dir;
        const [x, , w] = body;
        const top = dir > 0 ? near : body[1];
        const h = dir > 0 ? body[1] + body[3] - near : near - body[1];
        if (!(w >= 1) || !(h > OVERLAP)) {
            bar.setMenuGrowth(this, null, 0);
            if (content)
                content.opacity = 0;
            return;
        }
        bar.setMenuGrowth(this, [x, top, w, h], this._host.radius());
        if (!content)
            return;
        const t = Math.min(Math.max((p - CONTENT_FROM) / (CONTENT_TO - CONTENT_FROM), 0), 1);
        content.opacity = Math.round(255 * t * t * (3 - 2 * t));
        // On the bar's side of the rest at first, then out with the shape. Only while it moves: at rest the shell owns
        // the content's translation.
        if (this._tickId)
            this._setSlide(-CONTENT_SLIDE * (1 - p) * dir);
        if (p >= 1 && Math.abs(this._slide) < 0.5) {
            content.remove_clip();
            return;
        }
        // Cut to the shape, so the content comes out of the bar with it.
        const [ax, ay] = content.get_transformed_position();
        const [aw] = content.get_transformed_size();
        const k = aw > 0 && content.width > 0 ? aw / content.width : 1;
        content.set_clip((x - ax) / k, (top - ay) / k, w / k, h / k);
    }
}

/** Whether animations are on in the shell's settings. */
export function animationsEnabled() {
    return St.Settings.get().enable_animations;
}
