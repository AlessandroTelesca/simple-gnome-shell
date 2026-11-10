import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Banners} from './banners.js';
import {Docks} from './dock.js';
import {DockBar} from './dockBar.js';
import {Frames} from './frames.js';
import {HiddenClocks} from './hiddenClock.js';
import {Indicators} from './indicators.js';
import {Labels} from './labels.js';
import {Menus} from './menus.js';
import {Osds} from './osd.js';
import {Previews} from './previews.js';
import {TextColor} from './textColor.js';
import {TopBars} from './topBar.js';

// Draws on the same surfaces, so the two cannot run at once: this one waits while that one is active.
const LIQUID_GLASS_UUID = 'liquid-glass@thinkingcoding1231.gmail.com';
const ACTIVE = ExtensionState.ACTIVE ?? ExtensionState.ENABLED;

export default class SimpleShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._parts = null;
        this._stateId = Main.extensionManager.connect('extension-state-changed', (_manager, extension) => {
            if (extension.uuid === LIQUID_GLASS_UUID)
                this._sync();
        });
        // The shell destroys uiGroup on shutdown without disabling extensions, and the parts work on its children.
        this._uiGroupId = Main.layoutManager.uiGroup.connect('destroy', () => {
            this._uiGroupId = 0;
            this._stop();
        });
        this._sync();
    }

    disable() {
        Main.extensionManager.disconnect(this._stateId);
        if (this._uiGroupId)
            Main.layoutManager.uiGroup.disconnect(this._uiGroupId);
        this._stop();
        this._settings = null;
    }

    _sync() {
        if (Main.extensionManager.lookup(LIQUID_GLASS_UUID)?.state === ACTIVE) {
            if (this._parts)
                console.log('[Simple GNOME Shell] waiting while Liquid Glass is active');
            this._stop();
        } else {
            this._start();
        }
    }

    _start() {
        if (this._parts)
            return;
        const settings = this._settings;
        this._frames = new Frames();
        // The bars first, for the menus, banners and popups to grow out of.
        this._parts = [TopBars, Docks, DockBar, Menus, Labels, Previews, Banners, Osds, HiddenClocks, TextColor, Indicators].map(Part => new Part(settings, this._frames));
    }

    _stop() {
        if (!this._parts)
            return;
        for (const part of this._parts.reverse())
            part.destroy();
        this._parts = null;
        this._frames.destroy();
        this._frames = null;
    }
}
