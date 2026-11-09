import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {composeShape, pinToEdge} from './layout.js';
import {Shape} from './shape.js';

/**
 * A shape of its own, grown out of a monitor's edge behind some actor, with no bar to grow out of: a banner or the
 * volume popup while the bar is hidden, or the hidden clock's tab.
 */
export class EdgeTab {
    constructor(settings) {
        this._settings = settings;
        this._shape = new Shape(settings);
        this._shape.setColor(settings.get_string('color'));
        this._colorId = settings.connect('changed::color', () => {
            this._shape.setColor(settings.get_string('color'));
            this._lastKey = '';
        });
        // Turning the blur on needs the pieces again.
        this._blurId = settings.connect('changed::blur', () => {
            this._lastKey = '';
        });
        this._lastKey = '';
    }

    /** Draws the rect on the stage, run out to `side` of `monitor`, below `sibling` in uiGroup. */
    place(rect, side, monitor, sibling, radius, opacity) {
        const uiGroup = Main.layoutManager.uiGroup;
        if (sibling.get_parent() === uiGroup)
            this._shape.stackBelow(sibling);
        const flare = this._settings.get_double('top-bar-flare');
        const alpha = Math.round(this._settings.get_double('opacity') * opacity);
        const {x: mx, y: my, width: mw, height: mh} = monitor;
        const local = [rect[0] - mx, rect[1] - my, rect[2], rect[3]];
        const body = pinToEdge(local, side, mw, mh);
        const key = JSON.stringify([mx, my, mw, mh, side, body, radius, flare, alpha]);
        if (key === this._lastKey)
            return;
        this._lastKey = key;
        const pieces = composeShape({side, monitorW: mw, monitorH: mh, body, radius, flare});
        this._shape.apply(pieces, [mx, my, mw, mh], alpha, opacity);
    }

    hide() {
        this._lastKey = '';
        this._shape.hide();
    }

    destroy() {
        this._settings.disconnect(this._colorId);
        this._settings.disconnect(this._blurId);
        this._shape.destroy();
    }
}
