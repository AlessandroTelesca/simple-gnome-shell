import {composeShape} from './layout.js';
import {addBar, removeBar} from './growth.js';
import {Shape} from './shape.js';

/**
 * What a top bar and a dock have in common: a shape grown out of one edge of a monitor, which things can grow out of.
 * The subclass calls setBody() from its per-frame sync.
 */
export class EdgeBar {
    constructor(settings, radiusKey, flareKey) {
        this._settings = settings;
        this._radiusKey = radiusKey;
        this._flareKey = flareKey;
        this.shape = new Shape();
        this.shape.setColor(settings.get_string('color'));
        this._growths = new Map();
        this._side = 'top';
        this._monitor = null;
        this._body = null;
        this._opacity = 255;
        this._lastKey = '';
        this._settingsIds = ['color', 'opacity', radiusKey, flareKey].map(key =>
            settings.connect(`changed::${key}`, () => {
                this.shape.setColor(settings.get_string('color'));
                this._lastKey = '';
                this._draw();
            }));
        addBar(this);
    }

    /** Things grow away from the edge the bar sits on. */
    get growDirection() {
        return this._side === 'bottom' ? -1 : 1;
    }

    /** The stage y of the side things grow out of. */
    glassEdge() {
        if (!this._body)
            return 0;
        const [, y, , h] = this._body;
        return this._monitor.y + (this._side === 'bottom' ? y : y + h);
    }

    /** Grows what `owner` holds out of the bar as `rect` on the stage; null takes it back in. */
    setMenuGrowth(owner, rect, radius) {
        this._growths.delete(owner);
        if (rect)
            this._growths.set(owner, {rect, radius});
        this._draw();
    }

    // `body` is local to `monitor` and reaches the edge on `side`; null hides the shape.
    setBody(monitor, side, body, opacity) {
        this._monitor = monitor;
        this._side = side;
        this._body = body;
        this._opacity = opacity;
        this._draw();
    }

    get drawn() {
        return this._body !== null;
    }

    /** The [x, width] on the stage that `menu` should line up with, or null to leave it its own size. */
    menuSpan(_menu) {
        return null;
    }

    _draw() {
        if (!this._body || !this._monitor) {
            if (this._lastKey !== 'hidden') {
                this._lastKey = 'hidden';
                this.shape.hide();
            }
            return;
        }
        const {x: mx, y: my, width: mw, height: mh} = this._monitor;
        const growths = [...this._growths.values()].map(({rect: [x, y, w, h], radius}) =>
            ({rect: [x - mx, y - my, w, h], radius}));
        const key = JSON.stringify([mx, my, mw, mh, this._side, this._body, this._opacity, growths]);
        if (key === this._lastKey)
            return;
        this._lastKey = key;
        const pieces = composeShape({
            side: this._side, monitorW: mw, monitorH: mh, body: this._body, growths,
            radius: this._settings.get_double(this._radiusKey),
            flare: this._settings.get_double(this._flareKey),
        });
        const alpha = Math.round(this._settings.get_double('opacity') * this._opacity);
        this.shape.apply(pieces, [mx, my, mw, mh], alpha);
    }

    destroy() {
        removeBar(this);
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._growths.clear();
        this.shape.destroy();
    }
}
