import {GeneratedStylesheet} from './generatedStyle.js';

// Only what this extension draws has this class, so what keeps the theme's background keeps the theme's text.
const DRAWN = '.simple-gnome-shell-transparent';
const FALLBACK = '#ffffff';

// Theme rules set a color on most widgets rather than inherit one, and on many tiles a solid dark background. Tiles here
// are shades of the text color, so they stay readable on any surface. With white text on black they match the theme.

// How strongly each kind of text shows, as the theme has it.
const TEXT = [
    [1, [
        '.popup-menu-item', '.popup-inactive-menu-item', '.background-app-item',
        '.calendar', '.calendar-day', '.calendar-day-heading', '.calendar-month-label', '.pager-button',
        '.datemenu-today-button', '.events-button', '.world-clocks-button', '.weather-button',
        '.world-clocks-header.no-world-clocks', '.weather-header.no-location',
        '.message-collapse-button', '.message-expand-button', '.message-close-button', '.notification-button',
        '.message-media-control', '.message', '.message-list', '.message-list-clear-button',
        '.icon-button', '.quick-toggle', '.quick-toggle-menu', '.quick-toggle-menu-button', '.toggle-switch', '.slider',
        '.dock-tray .panel-button', '.show-apps .overview-icon', '.system-action-icon',
    ]],
    [0.7, [
        '.calendar-day.calendar-weekend', '.calendar-week-number',
        '.events-title', '.event-time', '.event-placeholder',
        '.world-clocks-header', '.world-clocks-timezone', '.weather-header', '.message-header',
    ]],
    [0.5, [
        '.calendar-day.calendar-other-month', '.calendar-day.calendar-other-month.calendar-weekend',
        '.popup-menu-item:insensitive', '.popup-inactive-menu-item:insensitive', '.message-media-control:insensitive',
        '.device-subtitle',
    ]],
    [0.45, ['.message-list-placeholder']],
];

// Tiles and how strongly they show at rest.
const TILES = [
    [0.21, [
        '.calendar-day', '.calendar-day-heading', '.calendar-month-label', '.pager-button',
        '.icon-button', '.quick-toggle', '.quick-toggle-menu-button',
    ]],
    [0.28, ['.message', '.events-button', '.world-clocks-button', '.weather-button', '.quick-toggle-menu']],
    [0.15, ['.message-list-clear-button', '.message-expand-button', '.message-close-button', '.notification-button', '.calendar-week-number']],
    [0.2, ['.message-collapse-button', '.quick-toggle-menu .header .icon']],
    [0.34, ['.popup-sub-menu']],
];
// Clear until the pointer is on them, then this strong.
const HOVER_TILES = [
    [0.26, ['.popup-menu-item']],
    [0.28, ['.datemenu-today-button']],
];
const SOLID = [
    [0.1, ['.popup-separator-menu-item-separator']],
    [0.25, ['.quick-toggle-separator']],
    [0.07, ['.message-icon.message-themed-icon']],
];
// Keep the accent color and the text made for it, in the states above.
const ACCENT = [
    '.calendar-day.calendar-today', '.icon-button.default', '.quick-toggle:checked', '.toggle-switch:checked',
    '.quick-toggle-menu-button:checked', '.quick-toggle-menu .header .icon.active',
];
const PANEL = `#panel${DRAWN}`;
const DOCK_BAR = '.simple-gnome-shell-dock-bar';

function css(color) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const shade = alpha => `rgba(${r}, ${g}, ${b}, ${alpha})`;
    const inside = selectors => selectors.map(selector => `${DRAWN} ${selector}`).join(', ');
    const rule = (selector, ...properties) =>
        `${selector} {\n${properties.map(p => `    ${p} !important;\n`).join('')}}\n`;
    const states = (selectors, state) => selectors.map(selector => `${selector}${state}`);
    const out = [];

    for (const [alpha, selectors] of TEXT)
        out.push(rule(inside(selectors), `color: ${shade(alpha)}`));
    for (const [alpha, selectors] of TILES) {
        out.push(rule(inside(selectors), `background-color: ${shade(alpha)}`));
        out.push(rule(inside(states(selectors, ':hover')), `background-color: ${shade(alpha + 0.06)}`));
        out.push(rule(inside(states(selectors, ':active')), `background-color: ${shade(alpha + 0.12)}`));
        out.push(rule(inside(states(selectors, ':selected')), `background-color: ${shade(alpha + 0.2)}`));
    }
    for (const [alpha, selectors] of HOVER_TILES) {
        out.push(rule(inside(states(selectors, ':hover')), `background-color: ${shade(alpha)}`));
        out.push(rule(inside(states(selectors, ':active')), `background-color: ${shade(alpha + 0.06)}`));
    }
    for (const [alpha, selectors] of SOLID)
        out.push(rule(inside(selectors), `background-color: ${shade(alpha)}`));

    out.push(rule(inside(ACCENT), 'color: -st-accent-fg-color', 'background-color: -st-accent-color'));
    out.push(rule(inside(states(ACCENT, ':hover')), 'color: -st-accent-fg-color',
        'background-color: st-lighten(-st-accent-color, 4%)'));
    out.push(rule(inside(states(ACCENT, ':active')), 'color: -st-accent-fg-color',
        'background-color: st-lighten(-st-accent-color, 9%)'));

    // The top bar, whose buttons Dock Tray's are built like.
    out.push(rule(`${PANEL} .panel-button`, `color: ${shade(1)}`));
    out.push(rule(`${PANEL} .panel-button#panelActivities .workspace-dot`, `background-color: ${shade(1)}`));
    out.push(rule(`${PANEL} .panel-button:hover`, `background-color: ${shade(0.15)}`));
    out.push(rule(`${PANEL} .panel-button:active, ${PANEL} .panel-button:checked`, `background-color: ${shade(0.25)}`));
    // On their own red, whatever the bar's color.
    out.push(rule(`${PANEL} .panel-button.screen-recording-indicator, ${PANEL} .panel-button.screen-sharing-indicator`,
        'color: #fafafb'));
    out.push(rule(inside(['.dock-tray .panel-button:hover .panel-status-indicators-box']),
        `background-color: ${shade(0.12)}`));
    out.push(rule(`${inside(['.dock-tray .panel-button:active .panel-status-indicators-box'])}, ` +
        inside(['.dock-tray .panel-button:checked .panel-status-indicators-box']), `background-color: ${shade(0.22)}`));

    // The top bar's buttons in the dock, whose highlight the theme draws as an inset shadow.
    out.push(rule(`${DOCK_BAR} .panel-button`, `color: ${shade(1)}`));
    out.push(rule(`${DOCK_BAR} .panel-button#panelActivities .workspace-dot`, `background-color: ${shade(1)}`));
    out.push(rule(`${DOCK_BAR} .panel-button:focus, ${DOCK_BAR} .panel-button:hover`,
        `box-shadow: inset 0 0 0 100px ${shade(0.17)}`));
    out.push(rule(`${DOCK_BAR} .panel-button:active, ${DOCK_BAR} .panel-button:checked`,
        `box-shadow: inset 0 0 0 100px ${shade(0.28)}`));
    const clock = `${DOCK_BAR} .panel-button.clock-display`;
    out.push(rule(`${clock}, ${clock}:focus, ${clock}:hover, ${clock}:active, ${clock}:checked`, 'box-shadow: none'));
    out.push(rule(`${clock}:focus .clock, ${clock}:hover .clock`, `box-shadow: inset 0 0 0 100px ${shade(0.17)}`));
    out.push(rule(`${clock}:active .clock, ${clock}:checked .clock`, `box-shadow: inset 0 0 0 100px ${shade(0.28)}`));
    out.push(rule(`${DOCK_BAR} .panel-button.screen-recording-indicator, ${DOCK_BAR} .panel-button.screen-sharing-indicator`,
        'color: #fafafb'));

    // What the class is on: a banner, the volume and brightness popup, and a menu, for what inherits its color.
    out.push(rule(`.message${DRAWN}, .osd-window${DRAWN}, .popup-menu-boxpointer${DRAWN}, .popup-menu-content${DRAWN}`,
        `color: ${shade(1)}`));
    out.push(rule(inside(['.level']), `-barlevel-background-color: ${shade(0.1)}`,
        `-barlevel-active-background-color: ${shade(1)}`));
    out.push(rule(inside(['.slider']), `-barlevel-background-color: ${shade(0.1)}`));

    // The tab Hide Top Bar: Multi Monitors leaves unpainted for this extension to draw.
    out.push(rule('.liquid-glass-backed .hidetopbar-mm-clock', `color: ${shade(1)}`));
    return out.join('');
}

/** Sets the color of the text and symbolic icons on everything this extension draws. */
export class TextColor {
    constructor(settings) {
        this._settings = settings;
        this._style = new GeneratedStylesheet('text-color.css');
        this._settingsId = settings.connect('changed::text-color', () => this._apply());
        this._apply();
    }

    _apply() {
        const color = this._settings.get_string('text-color');
        this._style.set(css(/^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK));
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._style.destroy();
    }
}
