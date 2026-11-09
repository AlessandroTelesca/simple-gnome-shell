import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BlurLayer} from './blur.js';
import {isActorValid} from './frames.js';

// A filled square with a quarter circle taken out of one corner, repainted only when its size or corner changes.
function repaintFillet(area) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const {color, radius, hollow} = area._fillet;
    const k = w / Math.max(area.width, 1);
    cr.setSourceRGB(...color);
    cr.paint();
    cr.setOperator(0); // CLEAR
    cr.arc(hollow[0] ? w : 0, hollow[1] ? h : 0, radius * k, 0, 2 * Math.PI);
    cr.fill();
    cr.$dispose();
}

// The bounds of `pieces`, cut to the monitor [0, 0, mw, mh]: [x0, y0, x1, y1], or null if nothing shows.
function piecesBounds(pieces, mw, mh) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const {x, y, w, h} of pieces) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + w);
        y1 = Math.max(y1, y + h);
    }
    [x0, y0, x1, y1] = [Math.max(x0, 0), Math.max(y0, 0), Math.min(x1, mw), Math.min(y1, mh)];
    return x1 - x0 >= 1 && y1 - y0 >= 1 ? [x0, y0, x1, y1] : null;
}

/**
 * Paints the pieces of composeShape() on one monitor, in one color. The pieces are opaque and the group carries the
 * opacity, so Clutter flattens them once and their overlaps do not show. Nothing is drawn again until a piece changes.
 * Below the group, a BlurLayer blurs what is behind the same pieces, and the color tints it.
 */
export class Shape {
    constructor(settings) {
        this.actor = new Clutter.Actor({name: 'simple-gnome-shell-shape', reactive: false, visible: false});
        this.actor.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
        this._rects = [];
        this._fillets = [];
        this._rgb = [0, 0, 0];
        this._hex = '#000000';
        // Its own actor below the group: a group with less than full opacity paints offscreen, where the screen behind
        // is not there to blur.
        this.blur = new BlurLayer(settings);
    }

    /** Puts the shape right below `sibling` in uiGroup, unless it is there already. */
    stackBelow(sibling) {
        const uiGroup = Main.layoutManager.uiGroup;
        if (this.actor.get_parent() !== uiGroup)
            uiGroup.insert_child_below(this.actor, sibling);
        else if (this.actor.get_next_sibling() !== sibling)
            uiGroup.set_child_below_sibling(this.actor, sibling);
        if (this.blur.get_parent() !== uiGroup)
            uiGroup.insert_child_below(this.blur, this.actor);
        else if (this.blur.get_next_sibling() !== this.actor)
            uiGroup.set_child_below_sibling(this.blur, this.actor);
    }

    setColor(hex) {
        const m = /^#([0-9a-f]{6})$/i.exec(hex);
        const value = m ? m[1] : '000000';
        this._hex = `#${value}`;
        this._rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
        for (const rect of this._rects)
            rect._style = null;
        for (const area of this._fillets)
            area._key = null;
    }

    /**
     * Shows `pieces` on the monitor [x, y, w, h], the tint at `opacity` and the blur at `fade` (0 to 255): the bar's
     * own fade, without the tint's opacity.
     */
    apply(pieces, [mx, my, mw, mh], opacity, fade = 255) {
        const actor = this.actor;
        if (actor.x !== mx || actor.y !== my || actor.width !== mw || actor.height !== mh) {
            actor.set_position(mx, my);
            actor.set_size(mw, mh);
            // A shape sliding out must not show on the next monitor.
            actor.set_clip(0, 0, mw, mh);
        }
        if (actor.opacity !== opacity)
            actor.opacity = opacity;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let rects = 0, fillets = 0;
        for (const piece of pieces) {
            const child = piece.type === 'rect'
                ? this._placeRect(rects++, piece, scale)
                : this._placeFillet(fillets++, piece);
            child.set_position(piece.x, piece.y);
            child.set_size(piece.w, piece.h);
            child.show();
        }
        for (let i = rects; i < this._rects.length; i++)
            this._rects[i].hide();
        for (let i = fillets; i < this._fillets.length; i++)
            this._fillets[i].hide();
        actor.show();
        this._applyBlur(pieces, mx, my, mw, mh, fade);
    }

    _applyBlur(pieces, mx, my, mw, mh, fade) {
        const blur = this.blur;
        const bounds = blur.enabled && fade > 0 ? piecesBounds(pieces, mw, mh) : null;
        if (!bounds || blur.get_parent() !== this.actor.get_parent()) {
            if (blur.visible)
                blur.hide();
            return;
        }
        const [x0, y0, x1, y1] = bounds;
        blur.set_position(mx + x0, my + y0);
        blur.set_size(x1 - x0, y1 - y0);
        blur.setPieces(pieces.map(piece => ({...piece, x: piece.x - x0, y: piece.y - y0})), fade);
        blur.show();
    }

    hide() {
        if (this.actor.visible)
            this.actor.hide();
        if (this.blur.visible)
            this.blur.hide();
    }

    destroy() {
        // The shell destroys uiGroup on shutdown without disabling extensions.
        if (isActorValid(this.actor))
            this.actor.destroy();
        if (isActorValid(this.blur))
            this.blur.destroy();
        this._rects = [];
        this._fillets = [];
    }

    _placeRect(index, piece, scale) {
        let rect = this._rects[index];
        if (!rect) {
            rect = new St.Widget({reactive: false});
            this.actor.add_child(rect);
            this._rects[index] = rect;
        }
        const radii = piece.radii.map(r => `${Math.round(r / scale)}px`).join(' ');
        const style = `background-color: ${this._hex}; border-radius: ${radii};`;
        if (rect._style !== style) {
            rect._style = style;
            rect.set_style(style);
        }
        return rect;
    }

    _placeFillet(index, piece) {
        let area = this._fillets[index];
        if (!area) {
            area = new St.DrawingArea({reactive: false});
            area.connect('repaint', repaintFillet);
            this.actor.add_child(area);
            this._fillets[index] = area;
        }
        const key = `${piece.radius},${piece.hollow}`;
        area._fillet = {color: this._rgb, radius: piece.radius, hollow: piece.hollow};
        if (area._key !== key) {
            area._key = key;
            area.queue_repaint();
        }
        return area;
    }
}
