import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {isActorValid} from './frames.js';
import {BarGrowth} from './growth.js';
import {EdgeTab} from './tab.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
// GNOME's slide in, on the banner's bin.
const BANNER_EASED = ['y', 'opacity', 'scale-x', 'scale-y'];

/**
 * Notification banners grow out of the top bar, under the clock. While the bar is hidden, a banner's shape grows out of
 * the screen's top edge instead. Runs while there is a banner and only then.
 */
export class Banners {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._tray = Main.messageTray;
        this._bin = this._tray._bannerBin;
        this._banner = null;
        this._grew = false;
        this._removeFrames = null;
        this._tab = new EdgeTab(settings);
        this._growth = new BarGrowth({
            key: 'notifications',
            content: () => this._banner,
            shown: () => !!this._banner?.mapped && this._tray.visible,
            scale: () => this._bin.scale_y || 1,
            // Banners belong to the clock.
            source: () => Main.panel.statusArea.dateMenu ?? null,
            button: () => {
                const clock = Main.panel.statusArea.dateMenu?._clockDisplay;
                if (!clock?.mapped)
                    return null;
                const [x, y] = clock.get_transformed_position();
                const [w, h] = clock.get_transformed_size();
                return Number.isFinite(x) && w > 0 ? [x, y, w, h] : null;
            },
            radius: () => settings.get_double('surface-radius'),
            // GNOME slides a banner in from above; the growth brings it instead. Its slide out is left as it is.
            hold: opening => {
                if (!opening)
                    return;
                for (const name of BANNER_EASED) {
                    const ease = this._bin.get_transition(name);
                    if (ease)
                        ease.set_from(ease.get_interval().peek_final_value());
                }
            },
            closed: () => {},
        });
        this._addedId = this._bin.connect('child-added', (_bin, actor) => this._onAdded(actor));
        this._removedId = this._bin.connect('child-removed', (_bin, actor) => {
            if (actor === this._banner)
                this._drop();
        });
        this._settingsId = settings.connect('changed::notifications-grow', () => {
            if (!settings.get_boolean('notifications-grow'))
                this._drop();
            else if (this._tray._banner)
                this._onAdded(this._tray._banner);
        });
        if (this._tray._banner)
            this._onAdded(this._tray._banner);
    }

    _onAdded(banner) {
        if (!this._settings.get_boolean('notifications-grow') || banner === this._banner)
            return;
        this._drop();
        this._banner = banner;
        banner.add_style_class_name(TRANSPARENT);
        this._grew = this._growth.start(true);
        this._removeFrames = this._frames.add(() => this._sync());
    }

    // A banner the shell removes at once leaves its shape to run back into the bar.
    _drop() {
        this._growth.retract();
        this._grew = false;
        this._tab.hide();
        if (isActorValid(this._banner))
            this._banner.remove_style_class_name(TRANSPARENT);
        this._banner = null;
        this._removeFrames?.();
        this._removeFrames = null;
    }

    _sync() {
        const banner = this._banner;
        if (!isActorValid(banner))
            return;
        // Grown out of the bar, the bar draws the shape; it runs back in as GNOME slides the banner away.
        const hiding = this._tray._notificationState === MessageTray.State.HIDING;
        if (hiding && this._growth.holding && this._growth.opening)
            this._growth.start(false);
        const barHolds = hiding ? this._growth.holding : this._growth.holdAtRest();
        this._grew ||= barHolds;
        if (barHolds || (hiding && this._grew)) {
            this._tab.hide();
            return;
        }
        const [x, y] = banner.get_transformed_position();
        const [w, h] = banner.get_transformed_size();
        const opacity = banner.get_paint_opacity();
        const monitor = Main.layoutManager.primaryMonitor;
        if (!banner.mapped || !this._tray.visible || opacity === 0 || !monitor ||
            ![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) {
            this._tab.hide();
            return;
        }
        this._tab.place([x, y, w, h], 'top', monitor, this._tray,
            this._settings.get_double('surface-radius'), opacity);
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        if (isActorValid(this._bin)) {
            this._bin.disconnect(this._addedId);
            this._bin.disconnect(this._removedId);
        }
        this._drop();
        this._growth.release();
        this._tab.destroy();
    }
}
