import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isActorValid} from './frames.js';

// The control center button's icons, by the names of the shell's fields that hold them (`QuickSettings._network`...).
// OTHERS stands for every icon that is none of them: those other extensions put on the button.
const NAMES = [
    'remoteAccess', 'camera', 'volumeInput', 'location', 'brightness', 'thunderbolt', 'nightLight', 'network',
    'darkMode', 'doNotDisturb', 'backlight', 'bluetooth', 'rfkill', 'autoRotate', 'volumeOutput', 'unsafeMode',
    'powerProfiles', 'system',
];
const OTHERS = 'others';

/** Hides the icons on the control center button that the settings leave out. Its menu keeps their entries. */
export class Indicators {
    constructor(settings) {
        this._settings = settings;
        this._hidden = new Map(); // icon -> its notify::visible handler
        this._button = Main.panel.statusArea.quickSettings ?? null;
        this._box = this._button?._indicators ?? null;
        // The shell adds the network and bluetooth icons late, and extensions add theirs as they start.
        this._boxIds = this._box ? [
            this._box.connect('child-added', () => this._apply()),
            this._box.connect('child-removed', (_box, icon) => this._release(icon)),
        ] : [];
        this._settingsId = settings.connect('changed::hidden-indicators', () => this._apply());
        this._apply();
    }

    _nameOf(icon) {
        return NAMES.find(name => this._button[`_${name}`] === icon) ?? OTHERS;
    }

    _apply() {
        if (!isActorValid(this._box))
            return;
        const leftOut = this._settings.get_strv('hidden-indicators');
        for (const icon of this._box.get_children()) {
            if (leftOut.includes(this._nameOf(icon)))
                this._hide(icon);
            else
                this._release(icon);
        }
    }

    _hide(icon) {
        if (this._hidden.has(icon))
            return;
        // Its owner shows it again whenever its state changes.
        this._hidden.set(icon, icon.connect('notify::visible', () => {
            if (icon.visible)
                icon.hide();
        }));
        icon.hide();
    }

    // Hands the icon back to its owner, shown if it has something to show.
    _release(icon) {
        const id = this._hidden.get(icon);
        if (id === undefined)
            return;
        this._hidden.delete(icon);
        if (!isActorValid(icon))
            return;
        icon.disconnect(id);
        // What the shell's SystemIndicator shows itself by. An icon without parts of its own is plainly shown.
        const parts = icon.get_children();
        icon.visible = parts.length === 0 || parts.some(part => part.visible);
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        if (isActorValid(this._box)) {
            for (const id of this._boxIds)
                this._box.disconnect(id);
        }
        for (const icon of [...this._hidden.keys()])
            this._release(icon);
    }
}
