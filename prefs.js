import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function hex(rgba) {
    const byte = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${byte(rgba.red)}${byte(rgba.green)}${byte(rgba.blue)}`;
}

export default class SimpleShellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Kept alive with the window.
        window._simpleShellSettings = settings;
        const page = new Adw.PreferencesPage();
        window.add(page);

        const watchIds = [];
        const watch = (key, fn) => watchIds.push(settings.connect(`changed::${key}`, fn));
        window.connect('close-request', () => {
            watchIds.splice(0).forEach(id => settings.disconnect(id));
            return false;
        });

        const defaultOf = key => settings.get_default_value(key).recursiveUnpack();

        // Shows `key`'s default on `row`, after its `note` if any, and adds the button that goes back to it. The default
        // comes from the schema, so this cannot fall out of step with it.
        const addDefault = (row, key, text, note) => {
            const label = _('Default: %s').format(text);
            row.subtitle = note ? `${note} · ${label}` : label;
            const button = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                tooltip_text: _('Reset to default (%s)').format(text),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular'],
            });
            button.connect('clicked', () => settings.reset(key));
            const sync = () => {
                button.sensitive = !settings.get_value(key).equal(settings.get_default_value(key));
            };
            watch(key, sync);
            sync();
            row.add_suffix(button);
        };

        const group = title => {
            const g = new Adw.PreferencesGroup({title});
            page.add(g);
            return g;
        };
        const toggle = (g, key, title, note) => {
            const row = new Adw.SwitchRow({title});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            addDefault(row, key, defaultOf(key) ? _('on') : _('off'), note);
            g.add(row);
            return row;
        };
        // The shown default: `format` for a special value, or the number and `unit`.
        const number = (g, key, title, lower, upper, step, {digits = 0, unit = _('px'), note, format} = {}) => {
            const value = digits ? settings.get_double(key) : settings.get_int(key);
            const row = new Adw.SpinRow({
                title,
                digits,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            const standard = defaultOf(key);
            addDefault(row, key, format?.(standard) ?? `${standard} ${unit}`.trim(), note);
            g.add(row);
            return row;
        };
        const radius = (g, key, title) => number(g, key, title, 0, 64, 1, {digits: 1});

        const look = group(_('Look'));
        const colorRow = new Adw.ActionRow({title: _('Color')});
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string('color'));
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba,
            valign: Gtk.Align.CENTER,
        });
        colorButton.connect('notify::rgba', () => {
            const value = hex(colorButton.rgba);
            if (value !== settings.get_string('color'))
                settings.set_string('color', value);
        });
        watch('color', () => {
            const value = settings.get_string('color');
            if (value === hex(colorButton.rgba))
                return;
            const color = new Gdk.RGBA();
            if (color.parse(value))
                colorButton.rgba = color;
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        addDefault(colorRow, 'color', defaultOf('color'));
        look.add(colorRow);
        number(look, 'opacity', _('Opacity'), 0, 1, 0.05, {digits: 2, unit: ''});

        const bar = group(_('Top bar'));
        toggle(bar, 'top-bar-enabled', _('Grow out of the screen edge'));
        const styles = ['center', 'pill'];
        const styleNames = [_('Centered, shrunk to its buttons'), _('Across the monitor')];
        const style = new Adw.ComboRow({
            title: _('Style'),
            model: Gtk.StringList.new(styleNames),
            selected: Math.max(styles.indexOf(settings.get_string('top-bar-style')), 0),
        });
        style.connect('notify::selected', () => {
            if (settings.get_string('top-bar-style') !== styles[style.selected])
                settings.set_string('top-bar-style', styles[style.selected]);
        });
        addDefault(style, 'top-bar-style', styleNames[styles.indexOf(defaultOf('top-bar-style'))]);
        bar.add(style);
        const margin = number(bar, 'top-bar-margin', _('Side margin'), 0, 200, 1);
        const syncStyle = () => {
            const selected = settings.get_string('top-bar-style');
            margin.sensitive = selected === 'pill';
            style.selected = Math.max(styles.indexOf(selected), 0);
        };
        watch('top-bar-style', syncStyle);
        syncStyle();
        number(bar, 'top-bar-height', _('Height'), 0, 100, 1, {
            format: value => (value === 0 ? _('0, the theme\'s height') : null),
        });
        number(bar, 'top-bar-padding', _('Room beside the buttons'), 0, 64, 1);
        radius(bar, 'top-bar-radius', _('Outward-rounded corners, radius'));
        radius(bar, 'top-bar-flare', _('Inward-curved flares, radius'));

        const dock = group(_('Dash to Dock'));
        toggle(dock, 'dock-enabled', _('Grow out of the screen edge'));
        const spaceNote = _('With Dash to Dock\'s icon size, these set the dock\'s height');
        number(dock, 'dock-space-edge', _('Space between the apps and the screen edge'), 0, 40, 1, {note: spaceNote});
        number(dock, 'dock-space-far', _('Space on the apps\' other side'), 0, 40, 1, {note: spaceNote});
        radius(dock, 'dock-radius', _('Outward-rounded corners, radius'));
        radius(dock, 'dock-flare', _('Inward-curved flares, radius'));

        const grow = group(_('Grown out of the bars'));
        toggle(grow, 'menus-grow', _('Top bar menus'));
        toggle(grow, 'dock-menus-grow', _('Dock menus'), _('On docks along the top or bottom of the screen'));
        toggle(grow, 'notifications-grow', _('Notifications'), _('Out of the screen edge while the bar is hidden'));
        toggle(grow, 'osd-grow', _('Volume and brightness popup'), _('Out of the screen edge while the bar is hidden'));
        toggle(grow, 'hidden-clock', _('Hidden clock tab'), _('Hide Top Bar: Multi Monitors\' clock, in this color'));
        radius(grow, 'surface-radius', _('Outward-rounded corners, radius'));
    }
}
