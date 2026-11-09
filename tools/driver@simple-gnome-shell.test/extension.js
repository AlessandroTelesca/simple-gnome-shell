// Drives Simple GNOME Shell in the headless shell started by tools/run-headless.sh. Reports through "[drv] ..." log
// lines and PNGs in $SGS_OUT, then terminates the shell.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('SGS_OUT');
const ONLY = GLib.getenv('SGS_STEPS')?.split(',');
const UUID = 'simple-gnome-shell@alessandrot';
const LG = 'liquid-glass@thinkingcoding1231.gmail.com';
const SHAPE = 'simple-gnome-shell-shape';

const say = text => console.log(`[drv] ${text}`);
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function shot(name) {
    return new Promise(resolve => {
        const stream = Gio.File.new_for_path(`${OUT}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
        const [w, h] = global.display.get_size();
        new Shell.Screenshot().screenshot_area(0, 0, w, h, stream, (obj, res) => {
            try {
                obj.screenshot_area_finish(res);
            } catch (e) {
                say(`shot ${name} failed: ${e}`);
            }
            stream.close(null);
            resolve();
        });
    });
}

const shapes = () => Main.layoutManager.uiGroup.get_children().filter(a => a.get_name() === SHAPE);
const visibleShapes = () => shapes().filter(a => a.visible);
const describe = () => visibleShapes().map(a => {
    const kids = a.get_children().filter(c => c.visible).map(c => `${c.x},${c.y} ${c.width}x${c.height}`);
    return `@${a.x},${a.y} op${a.opacity} [${kids.join(' | ')}]`;
}).join('\n[drv]   ');

function schemaSettings(uuid, id) {
    const dir = Main.extensionManager.lookup(uuid).dir.get_child('schemas').get_path();
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({settings_schema: source.lookup(id, true)});
}

function findAppIcon() {
    const walk = actor => {
        if (actor.app && actor.popupMenu)
            return actor;
        for (const child of actor.get_children()) {
            const found = walk(child);
            if (found)
                return found;
        }
        return null;
    };
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (child.get_name() === 'dashtodockContainer' && child.mapped) {
            const icon = walk(child);
            if (icon)
                return icon;
        }
    }
    return null;
}

const STEPS = {
    // Each blur style under a light tint, with the notification center open for its corners and fillets.
    async blur() {
        const s = schemaSettings(UUID, 'org.gnome.shell.extensions.simple-gnome-shell');
        const saved = ['opacity', 'blur', 'blur-style', 'blur-radius'].map(k => [k, s.get_value(k)]);
        const menu = Main.panel.statusArea.dateMenu.menu;
        s.set_double('opacity', 0.2);
        menu.open(true);
        await wait(1400);
        for (const [style, radius] of [['smooth', 24], ['fast', 24], ['frosted', 24], ['smooth', 60], ['smooth', 4]]) {
            s.set_boolean('blur', true);
            s.set_string('blur-style', style);
            s.set_int('blur-radius', radius);
            await wait(300);
            await shot(`00-blur-${style}-${radius}`);
        }
        s.set_boolean('blur', false);
        await wait(300);
        await shot('00-blur-off');
        menu.close(true);
        await wait(1200);
        for (const [k, v] of saved)
            s.set_value(k, v);
        await wait(300);
        const blurs = Main.layoutManager.uiGroup.get_children().filter(a => a.get_name() === 'simple-gnome-shell-blur');
        say(`blur layers ${blurs.length}, visible ${blurs.filter(a => a.visible).map(a => `${a.x},${a.y} ${a.width}x${a.height}`).join(' | ')}`);
    },
    async idle() {
        await shot('01-idle');
        say(`shapes ${shapes().length}, visible ${visibleShapes().length}\n[drv]   ${describe()}`);
        say(`main panel style "${Main.panel.get_style()}" width ${Main.panel.width}`);
    },
    async dateMenu() {
        const menu = Main.panel.statusArea.dateMenu.menu;
        menu.open(true);
        await wait(90);
        await shot('02-date-opening');
        await wait(1400);
        await shot('03-date-open');
        say(`date open: opacity ${menu.actor.opacity}, box ${menu.box.opacity}, transparent ${menu.box.has_style_class_name('simple-gnome-shell-transparent')}\n[drv]   ${describe()}`);
        menu.close(true);
        await wait(100);
        await shot('04-date-closing');
        await wait(1200);
        say(`date closed: visible ${menu.actor.visible}, transparent ${menu.box.has_style_class_name('simple-gnome-shell-transparent')}, box opacity ${menu.box.opacity}`);
        await shot('05-date-closed');
    },
    // The notification center ends flush with a centered bar, whichever of them is wider. No other menu is touched.
    async dateMenuFit() {
        const s = schemaSettings(UUID, 'org.gnome.shell.extensions.simple-gnome-shell');
        const menu = Main.panel.statusArea.dateMenu.menu;
        const other = Main.panel.statusArea.quickSettings.menu;
        const report = label => {
            const [bx] = menu.box.get_transformed_position();
            const [px] = Main.panel.get_transformed_position();
            say(`${label}: bar ${px}+${Main.panel.width}, menu ${bx}+${menu.box.width}, ` +
                `translation ${menu.box.translation_x}, min set ${menu.box.min_width_set}\n[drv]   ${describe()}`);
        };
        const open = async (name, label) => {
            menu.open(true);
            await wait(1400);
            await shot(name);
            report(label);
            menu.close(true);
            await wait(1200);
        };
        // A wide bar in the panel's left box, since only the buttons set its width.
        const spacer = new St.Widget({width: 0});
        Main.panel._leftBox.add_child(spacer);

        await open('08a-fit-as-is', 'as is');
        spacer.width = 900;
        await wait(500);
        await open('08b-fit-wide-bar', 'wide bar');
        spacer.width = 180;
        await wait(500);
        await open('08c-fit-close-widths', 'bar just wider');
        // Moved off the bar's center, as a dock fixed to a side does.
        menu._boxPointer._sourceAlignment = 0.1;
        await open('08d-fit-off-center', 'off center');
        menu._boxPointer._sourceAlignment = 0.5;

        menu.open(true);
        await wait(1400);
        spacer.width = 600;
        await wait(400);
        await shot('08e-fit-bar-resized-open');
        report('resized while open');
        menu.close(true);
        await wait(1200);
        say(`closed: min set ${menu.box.min_width_set}, translation ${menu.box.translation_x}`);

        other.open(true);
        await wait(1400);
        await shot('08f-fit-other-menu');
        say(`quick settings: min set ${other.box.min_width_set}, translation ${other.box.translation_x}, width ${other.box.width}\n[drv]   ${describe()}`);
        other.close(true);
        await wait(1200);

        s.set_string('top-bar-style', 'pill');
        await wait(500);
        await open('08g-fit-across', 'across the monitor');
        s.reset('top-bar-style');
        spacer.destroy();
        await wait(500);
    },
    async quickSettings() {
        const menu = Main.panel.statusArea.quickSettings.menu;
        menu.open(true);
        await wait(1400);
        await shot('06-qs-open');
        menu.close(true);
        await wait(1200);
        say(`qs closed: visible ${menu.actor.visible}`);
    },
    async dockMenu() {
        const icon = findAppIcon();
        say(`app icon ${icon}`);
        if (!icon)
            return;
        icon.popupMenu();
        await wait(1400);
        await shot('07-dock-menu');
        say(`dock menu open\n[drv]   ${describe()}`);
        icon._menu.close(true);
        await wait(1200);
        say(`dock menu closed: visible ${icon._menu.actor.visible}`);
    },
    async secondaryBar() {
        const panel = Main.layoutManager.uiGroup.get_children().flatMap(box => box.get_children?.() ?? [])
            .find(a => a.statusArea?.dateMenu && a !== Main.panel);
        say(`second bar ${panel}`);
        if (!panel)
            return;
        const menu = panel.statusArea.dateMenu.menu;
        menu.open(true);
        await wait(1400);
        await shot('07b-second-bar-menu');
        say(`second bar menu: open ${menu.isOpen}\n[drv]   ${describe()}`);
        menu.close(true);
        await wait(1200);
        say(`second bar menu closed: visible ${menu.actor.visible}`);
    },
    async dockTray() {
        const demo = GLib.build_filenamev([GLib.get_home_dir(), 'GIT/dock-tray/tools/tray-demo.py']);
        const proc = Gio.Subprocess.new(['python3', demo], Gio.SubprocessFlags.NONE);
        await wait(5000);
        const inDock = a => {
            for (let p = a; p; p = p.get_parent()) {
                if (p.get_name() === 'dashtodockDashContainer')
                    return true;
            }
            return false;
        };
        const button = Object.values(Main.panel.statusArea).find(b => b?.menu?.actor && inDock(b.container ?? b));
        say(`tray button in dock: ${button}`);
        await shot('07c-tray-in-dock');
        if (button) {
            button.menu.open(true);
            await wait(1400);
            await shot('07d-tray-menu');
            say(`tray menu\n[drv]   ${describe()}`);
            button.menu.close(true);
            await wait(1200);
            say(`tray menu closed: visible ${button.menu.actor.visible}`);
        }
        proc.force_exit();
        await wait(1000);
    },
    async notification() {
        Main.notify('A test notification', 'Its body, grown out of the top bar');
        await wait(120);
        await shot('08-banner-opening');
        await wait(1200);
        await shot('09-banner-open');
        say(`banner open\n[drv]   ${describe()}`);
        Main.messageTray._hideNotification?.(true);
        await wait(1500);
        say(`banner after hide: ${Main.messageTray._banner}, shapes visible ${visibleShapes().length}`);
    },
    async osd() {
        const icon = new Gio.ThemedIcon({name: 'audio-volume-medium-symbolic'});
        Main.osdWindowManager.showAll(icon, null, 0.6, 1);
        await wait(1000);
        await shot('10-osd-open');
        say(`osd open\n[drv]   ${describe()}`);
        await wait(3500);
        await shot('11-osd-gone');
        say(`osd gone\n[drv]   ${describe()}`);
    },
    async dockSlide() {
        const root = Main.layoutManager.uiGroup.get_children().find(a => a.get_name() === 'dashtodockContainer');
        root._animateOut(0.4, 0);
        await wait(70);
        await shot('12-dock-sliding');
        say(`dock sliding\n[drv]   ${describe()}`);
        await wait(800);
        await shot('13-dock-hidden');
        say(`dock hidden\n[drv]   ${describe()}`);
        root._animateIn(0.4, 0);
        await wait(800);
        await shot('14-dock-back');
    },
    async hiddenBar() {
        const htb = schemaSettings('hidetopbar@mathieu.bidon.ca', 'org.gnome.shell.extensions.hidetopbar');
        htb.set_boolean('enable-intellihide', false);
        await wait(1500);
        await shot('15-bar-hidden');
        say(`bar hidden: panelBox y ${Main.layoutManager.panelBox.y} visible ${Main.layoutManager.panelBox.visible}\n[drv]   ${describe()}`);
        Main.notify('Bar hidden', 'This banner has no bar to grow out of');
        await wait(1300);
        await shot('16-banner-edge');
        Main.messageTray._hideNotification?.(true);
        await wait(1500);
        Main.osdWindowManager.showAll(new Gio.ThemedIcon({name: 'audio-volume-medium-symbolic'}), null, 0.3, 1);
        await wait(900);
        await shot('17-osd-edge');
        await wait(3500);
        htb.set_boolean('enable-intellihide', true);
        await wait(1500);
        await shot('18-bar-back');
    },
    async settings() {
        const s = schemaSettings(UUID, 'org.gnome.shell.extensions.simple-gnome-shell');
        s.set_string('color', '#7a1f3d');
        s.set_double('opacity', 1);
        await wait(500);
        await shot('19-color');
        s.set_string('top-bar-style', 'pill');
        await wait(500);
        await shot('20-pill');
        s.reset('top-bar-style');
        s.reset('color');
        s.reset('opacity');
        s.set_boolean('dock-enabled', false);
        await wait(500);
        say(`dock off: shapes ${shapes().length}`);
        s.reset('dock-enabled');
        await wait(1500);
        say(`dock on: shapes ${shapes().length}`);
    },
    async prefs() {
        const proc = Gio.Subprocess.new(['gnome-extensions', 'prefs', UUID], Gio.SubprocessFlags.NONE);
        await wait(5000);
        await shot('20b-prefs');
        say(`windows: ${global.get_window_actors().map(a => a.meta_window.get_title()).join(', ')}`);
        for (const a of global.get_window_actors())
            a.meta_window.delete(global.get_current_time());
        await wait(800);
        proc.force_exit();
    },
    async sizes() {
        const s = schemaSettings(UUID, 'org.gnome.shell.extensions.simple-gnome-shell');
        await shot('30-sizes-default');
        say(`default sizes\n[drv]   ${describe()}`);
        s.set_int('dock-space-edge', 16);
        s.set_int('dock-space-far', 2);
        s.set_int('top-bar-height', 44);
        await wait(700);
        await shot('31-sizes-big-bar');
        say(`edge 16, far 2, bar 44: panelBox ${Main.layoutManager.panelBox.height}\n[drv]   ${describe()}`);
        s.set_int('top-bar-height', 24);
        s.set_int('dock-space-edge', 0);
        s.set_int('dock-space-far', 0);
        await wait(700);
        await shot('32-sizes-small-bar');
        say(`edge 0, far 0, bar 24: panelBox ${Main.layoutManager.panelBox.height}\n[drv]   ${describe()}`);
        Main.panel.statusArea.dateMenu.menu.open(true);
        await wait(1300);
        await shot('33-small-bar-menu');
        Main.panel.statusArea.dateMenu.menu.close(true);
        await wait(1000);
        for (const key of ['dock-space-edge', 'dock-space-far', 'top-bar-height'])
            s.reset(key);
        s.set_double('top-bar-radius', 6);
        s.set_double('top-bar-flare', 30);
        s.set_double('dock-radius', 34);
        s.set_double('dock-flare', 4);
        await wait(700);
        await shot('34-radii');
        say(`radii changed\n[drv]   ${describe()}`);
        for (const key of ['top-bar-radius', 'top-bar-flare', 'dock-radius', 'dock-flare'])
            s.reset(key);
        await wait(500);
        say(`reset: panel style "${Main.panel.get_style()}" panelBox ${Main.layoutManager.panelBox.height}`);
    },
    // The undo buttons, with values off their defaults. SGS_CLICKS is "x,y;x,y": where to click in the window.
    async prefsReset() {
        const s = schemaSettings(UUID, 'org.gnome.shell.extensions.simple-gnome-shell');
        s.set_string('color', '#7a1f3d');
        s.set_string('top-bar-style', 'pill');
        s.set_int('top-bar-height', 40);
        s.set_double('dock-flare', 30);
        s.set_boolean('osd-grow', false);
        const proc = Gio.Subprocess.new(['gnome-extensions', 'prefs', UUID], Gio.SubprocessFlags.NONE);
        await wait(4000);
        const win = global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === 'Simple GNOME Shell');
        win.move_resize_frame(true, 100, 60, 760, 2300);
        await wait(1200);
        await shot('40-prefs-changed');
        const state = () => ['color', 'top-bar-style', 'top-bar-height', 'dock-flare', 'osd-grow']
            .map(k => `${k}=${s.get_value(k).print(false)}`).join(' ');
        say(`before clicks: ${state()}`);
        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        for (const spot of (GLib.getenv('SGS_CLICKS') ?? '').split(';').filter(Boolean)) {
            const [x, y] = spot.split(',').map(Number);
            const now = () => GLib.get_monotonic_time();
            pointer.notify_absolute_motion(now(), x, y);
            await wait(250);
            pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            await wait(60);
            pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await wait(500);
            say(`clicked ${spot}: ${state()}`);
        }
        await wait(600);
        await shot('41-prefs-after');
        win.delete(global.get_current_time());
        await wait(800);
        proc.force_exit();
        for (const k of ['color', 'top-bar-style', 'top-bar-height', 'dock-flare', 'osd-grow'])
            s.reset(k);
    },
    async lifecycle() {
        const before = shapes().length;
        for (let i = 0; i < 2; i++) {
            Main.extensionManager.disableExtension(UUID);
            await wait(400);
            say(`disabled: shapes ${shapes().length}, panel style "${Main.panel.get_style()}", class ${Main.panel.has_style_class_name('simple-gnome-shell-transparent')}, width ${Main.panel.width}`);
            if (i === 0)
                await shot('21-disabled');
            Main.extensionManager.enableExtension(UUID);
            await wait(800);
            say(`enabled: shapes ${shapes().length} (was ${before})`);
        }
        await shot('22-reenabled');
    },
    async liquidGlassGuard() {
        const ok = Main.extensionManager.enableExtension(LG);
        await wait(2500);
        say(`LG enabled ${ok}: shapes ${shapes().length}`);
        await shot('23-with-lg');
        Main.extensionManager.disableExtension(LG);
        await wait(1500);
        say(`LG disabled: shapes ${shapes().length}`);
        await shot('24-after-lg');
    },
};

// Disabling the extension under test disables and enables those after it, this driver too.
let started = false;

export default class Driver extends Extension {
    enable() {
        if (started)
            return;
        started = true;
        this._run().catch(e => say(`driver failed: ${e}\n${e.stack}`));
    }

    disable() {}

    async _run() {
        await wait(6000);
        Main.overview.hide();
        await wait(1500);
        say(`extensions: ${Main.extensionManager.getUuids().map(u => {
            const e = Main.extensionManager.lookup(u);
            return `${u}=${e.state}${e.error ? `(${e.error})` : ''}`;
        }).filter(s => !s.includes('=6') && !s.includes('=2')).join(' ')}`);
        for (const [name, step] of Object.entries(STEPS)) {
            if (ONLY && !ONLY.includes(name))
                continue;
            say(`--- ${name}`);
            try {
                await step();
            } catch (e) {
                say(`step ${name} failed: ${e}\n${e.stack}`);
            }
        }
        say('done');
        global.context.terminate();
    }
}
