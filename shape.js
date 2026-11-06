import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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

/**
 * Paints the pieces of composeShape() on one monitor, in one color. The pieces are opaque and the group carries the
 * opacity, so Clutter flattens them once and their overlaps do not show. Nothing is drawn again until a piece changes.
 */
export class Shape {
    constructor() {
        this.actor = new Clutter.Actor({name: 'simple-gnome-shell-shape', reactive: false, visible: false});
        this.actor.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
        this._rects = [];
        this._fillets = [];
        this._rgb = [0, 0, 0];
        this._hex = '#000000';
    }

    /** Puts the shape right below `sibling` in uiGroup, unless it is there already. */
    stackBelow(sibling) {
        const uiGroup = Main.layoutManager.uiGroup;
        if (this.actor.get_parent() !== uiGroup)
            uiGroup.insert_child_below(this.actor, sibling);
        else if (this.actor.get_next_sibling() !== sibling)
            uiGroup.set_child_below_sibling(this.actor, sibling);
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

    /** Shows `pieces` on the monitor [x, y, w, h] at `opacity` (0 to 255). */
    apply(pieces, [mx, my, mw, mh], opacity) {
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
    }

    hide() {
        if (this.actor.visible)
            this.actor.hide();
    }

    destroy() {
        // The shell destroys uiGroup on shutdown without disabling extensions.
        if (isActorValid(this.actor))
            this.actor.destroy();
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
