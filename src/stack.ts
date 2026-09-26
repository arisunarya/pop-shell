import type { Entity } from './ecs.js';
import type { Ext } from './extension.js';
import type { ShellWindow } from './window.js';

import * as Ecs from './ecs.js';
import * as a from './arena.js';

const Arena = a.Arena;
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const URGENT_TAB_COLOR = '#D00';

/** Solid white for the last-active tab of an unfocused stack. */
const UNFOCUSED_ACTIVE_COLOR = 'rgba(255, 255, 255, 1)';

/** White at 50% opacity for inactive tabs (focused or not). */
const INACTIVE_DIM_COLOR = 'rgba(255, 255, 255, 0.5)';

export var TAB_HEIGHT: number = 12;

/** Width of the active stack pill segment, in pixels. */
const SEGMENT_ACTIVE_WIDTH = 56;

/** Width of an inactive stack segment, in pixels. Same as the active
 *  width so all pills in the strip share one size. */
const SEGMENT_INACTIVE_WIDTH = 56;



interface Tab {
    active: boolean;
    entity: Entity;
    button: number;
    button_signal: SignalID | null;
    signals: Array<SignalID>;
}

interface StackWidgets {
    tabs: St.Widget;
}

function stack_widgets_new(gap: number): StackWidgets {
    let tabs = new St.BoxLayout({
        style_class: 'pop-shell-stack',
        x_expand: true,
    });

    // Transparent container floating in the gap; spacing gives the
    // margin gap between pill bars.
    tabs.set_style(
        `background: transparent; border-width: 0; padding: 0; margin: 0; spacing: ${gap}px;`,
    );
    try {
        (tabs as any).spacing = gap;
    } catch (_e) {}

    return { tabs };
}

interface TabButton extends St.Button {
    bar: St.Widget;
    set_title: (title: string) => void;
}

// Minimal tab indicator: a thin clickable line segment.
// No icon, title, or close button. The visible line is a solid child
// bar, since St only parses a subset of CSS (no per-side border shorthand).
const TabButton = GObject.registerClass(
    {
        Signals: { activate: {} },
    },
    class TabButton extends St.Button {
        bar!: St.Widget;

        _init() {
            super._init({
                x_expand: false,
                y_expand: false,
            });

            this.bar = new St.Widget({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.set_child(this.bar);
        }

        set_title(_text: string) {}
    },
);

export class Stack {
    ext: Ext;

    widgets: null | StackWidgets = null;

    active: Entity;

    active_id: number = 0;

    prev_active: null | Entity = null;
    prev_active_id: number = 0;

    tabs: Array<Tab> = new Array();

    monitor: number;

    workspace: number;

    buttons: a.Arena<TabButton> = new Arena();

    tabs_height: number = TAB_HEIGHT;

    stack_rect: Rectangular = { width: 0, height: 0, x: 0, y: 0 };

    private active_signals: [SignalID, SignalID] | null = null;

    private rect: Rectangular = { width: 0, height: 0, x: 0, y: 0 };

    private restacker: SignalID = global.display.connect('restacked', () => this.restack());

    private tabs_destroy: SignalID;

    constructor(ext: Ext, active: Entity, workspace: number, monitor: number) {
        this.ext = ext;
        this.active = active;
        this.monitor = monitor;
        this.workspace = workspace;
        this.tabs_height = Math.max(TAB_HEIGHT * this.ext.dpi, this.pill_thickness());

        this.widgets = stack_widgets_new(this.segment_gap());

        global.window_group.add_child(this.widgets.tabs);

        this.reposition();

        this.tabs_destroy = this.widgets.tabs.connect('destroy', () => this.recreate_widgets());
    }

    /** Adds a new window to the stack */
    add(window: ShellWindow) {
        if (!this.widgets) return;

        const entity = window.entity;
        const active = Ecs.entity_eq(entity, this.active);

        const button = new TabButton();
        const id = this.buttons.insert(button);

        let tab: Tab = { active, entity, signals: [], button: id, button_signal: null };
        let comp = this.tabs.length;
        this.bind_hint_events(tab);
        this.tabs.push(tab);
        this.watch_signals(comp, id, window);
        this.widgets.tabs.add_child(button);
    }

    /** Activates a tab based on the previously active entry */
    auto_activate(): null | Entity {
        if (this.tabs.length === 0) return null;

        if (this.tabs.length <= this.active_id) {
            this.active_id = this.tabs.length - 1;
        }

        const c = this.tabs[this.active_id];

        this.activate(c.entity);
        return c.entity;
    }

    activate_prev() {
        if (this.prev_active) {
            this.activate(this.prev_active);
        }
    }

    /** Activates the tab of this entity */
    activate(entity: Entity) {
        const permitted = this.permitted_to_show();

        if (this.widgets) this.widgets.tabs.visible = permitted;

        this.reset_visibility(permitted);

        const win = this.ext.windows.get(entity);
        if (!win) return;

        if (!Ecs.entity_eq(entity, this.active)) {
            this.prev_active = this.active;
            this.prev_active_id = this.active_id;
        }

        this.active_connect(win.meta, entity);

        let id = 0;

        for (const component of this.tabs.values()) {
            this.window_exec(id, component.entity, (window) => {
                const actor = window.meta.get_compositor_private();

                if (Ecs.entity_eq(entity, component.entity)) {
                    this.active_id = id;
                    component.active = true;
                    if (actor) actor.show();
                } else {
                    component.active = false;
                    if (actor) actor.hide();
                }

                let button = this.buttons.get(component.button);
                if (button) {
                    this.paint_tab(button, component.active ? 'active' : 'inactive', this.is_focused());
                }
            });

            id += 1;
        }

        this.reset_visibility(permitted);
    }

    /** Whether one of this stack's windows currently holds global focus. */
    is_focused(): boolean {
        const focused = this.ext.focus_window();
        if (!focused) return false;
        for (const tab of this.tabs) {
            if (Ecs.entity_eq(tab.entity, focused.entity)) return true;
        }
        return false;
    }

    /** Repaints every tab from current focus state.
     *  Call after global focus changes so unfocused stacks turn white
     *  and the focused stack shows the accent pill. */
    refresh_tab_colors() {
        const focused = this.is_focused();
        for (const tab of this.tabs) {
            const button = this.buttons.get(tab.button);
            if (!button) continue;
            const is_active = Ecs.entity_eq(tab.entity, this.active);
            this.paint_tab(button, is_active ? 'active' : 'inactive', focused);
        }
    }

    /** Paints a tab segment as a floating pill.
     *  Focused stack: active = accent, inactive = white 50%.
     *  Unfocused stack: last-active = white solid, rest = white 50%. */
    private paint_tab(button: TabButton, state: 'active' | 'inactive' | 'urgent', focused: boolean = false) {
        let color = INACTIVE_DIM_COLOR;
        let width = SEGMENT_INACTIVE_WIDTH * this.ext.dpi;
        if (state === 'active') {
            width = SEGMENT_ACTIVE_WIDTH * this.ext.dpi;
            color = focused ? this.ext.settings.hint_color_rgba() : UNFOCUSED_ACTIVE_COLOR;
        } else if (state === 'urgent') {
            color = URGENT_TAB_COLOR;
            width = SEGMENT_ACTIVE_WIDTH * this.ext.dpi;
        }

        button.width = width;
        // Gap between pills is provided by the tabs container spacing
        // (see stack_widgets_new); keep button margins at zero so the
        // measured total_width (widths + GAP*(n-1)) stays exact.
        button.set_style('background: transparent; border-width: 0; padding: 0; margin: 0;');

        button.bar.width = width;
        const thickness = this.pill_thickness();
        button.bar.height = thickness;
        button.bar.set_style(`background-color: ${color}; border-radius: ${thickness}px;`);
    }

    /** Thickness of a stack pill: the window gaps setting in dpi-aware
     *  pixels (gap 5 == 5px tall), matching the active hint pill. */
    pill_thickness(): number {
        return this.ext.settings.gap_inner() * this.ext.dpi;
    }

    /** Horizontal gap between pill bars: half the window inner gap, so the
     *  strip spacing follows the window gaps setting. */
    segment_gap(): number {
        return this.ext.gap_inner_half;
    }

    /** Connects `on_window_changed` callbacks to the newly-active window */
    private active_connect(window: Meta.Window, active: Entity) {
        // Disconnect before attaching new window as active window
        this.active_disconnect();

        // Memorize them for future calls
        this.active = active;

        this.active_reconnect(window);
    }

    private active_reconnect(window: Meta.Window) {
        // Attach this callback on both signals of the window
        const on_window_changed = () =>
            this.on_grab(() => {
                const window = this.ext.windows.get(this.active);
                if (window) {
                    this.update_positions(window.meta.get_frame_rect());
                    this.window_changed();
                } else {
                    this.active_disconnect();
                }
            });

        this.active_signals = [
            window.connect('size-changed', on_window_changed),
            window.connect('position-changed', on_window_changed),
        ];
    }

    /** Disconnects signals from the active window in the stack */
    private active_disconnect() {
        const active_meta = this.active_meta();

        if (this.active_signals && active_meta) {
            for (const s of this.active_signals) active_meta.disconnect(s);
        }

        this.active_signals = null;
    }

    private active_meta(): Meta.Window | undefined {
        return this.ext.windows.get(this.active)?.meta;
    }

    private bind_hint_events(tab: Tab) {
        let settings = this.ext.settings;
        let button = this.buttons.get(tab.button);
        if (button) {
            let change_id = settings.ext.connect('changed', (_, key) => {
                if (key === 'hint-color-rgba') {
                    this.change_tab_color(tab);
                }
                return false;
            });
            button.connect('destroy', () => {
                settings.ext.disconnect(change_id);
            });
        }
        this.change_tab_color(tab);
    }

    private change_tab_color(tab: Tab) {
        let button = this.buttons.get(tab.button);
        if (button) {
            this.paint_tab(
                button,
                Ecs.entity_eq(tab.entity, this.active) ? 'active' : 'inactive',
                this.is_focused(),
            );
        }
    }

    /** Clears watched tabs and removes all tabs */
    clear() {
        this.active_disconnect();
        for (const c of this.tabs.splice(0)) this.tab_disconnect(c);
        this.widgets?.tabs.destroy_all_children();
        this.buttons.truncate(0);
    }

    /** Disconnects a tab from the stack */
    tab_disconnect(c: Tab) {
        const window = this.ext.windows.get(c.entity);
        if (window) {
            for (const s of c.signals) window.meta.disconnect(s);
            if (this.workspace === this.ext.active_workspace()) window.meta.get_compositor_private()?.show();
        }

        c.signals = [];

        if (c.button_signal) {
            const b = this.buttons.get(c.button);
            if (b) {
                b.disconnect(c.button_signal);
                c.button_signal = null;
            }
        }
    }

    /** Deactivate the signals belonging to an entity */
    deactivate(w: ShellWindow) {
        for (const c of this.tabs)
            if (Ecs.entity_eq(c.entity, w.entity)) {
                this.tab_disconnect(c);
            }

        if (this.active_signals && Ecs.entity_eq(this.active, w.entity)) {
            this.active_disconnect();
        }
    }

    /** Disconnects this stack's signal, and destroys its widgets */
    destroy() {
        global.display.disconnect(this.restacker);
        this.active_disconnect();

        // Disconnect stack signals from each window, and unhide them.
        for (const c of this.tabs) {
            this.tab_disconnect(c);
            if (this.workspace === this.ext.active_workspace()) {
                const win = this.ext.windows.get(c.entity);
                if (win) {
                    win.meta.get_compositor_private()?.show();
                    win.stack = null;
                }
            }
        }

        for (const b of this.buttons.values()) {
            try {
                b.destroy();
            } catch (e) {}
        }

        if (this.widgets) {
            const tabs = this.widgets.tabs;
            this.widgets = null;
            tabs.destroy();
        }
    }

    private on_grab(or: () => void) {
        if (this.ext.grab_op !== null) {
            if (Ecs.entity_eq(this.ext.grab_op.entity, this.active)) {
                if (this.widgets) {
                    const parent = this.widgets.tabs.get_parent();
                    const actor = this.active_meta()?.get_compositor_private();
                    if (actor && parent) {
                        parent.set_child_below_sibling(this.widgets.tabs, actor);
                    }
                }

                return;
            }
        }

        or();
    }

    /** Workaround for when GNOME Shell destroys our widgets when they're reparented
     *  in an active workspace change. */
    recreate_widgets() {
        if (this.widgets !== null) {
            this.widgets.tabs.disconnect(this.tabs_destroy);
            this.widgets = stack_widgets_new(this.segment_gap());

            global.window_group.add_child(this.widgets.tabs);

            this.tabs_destroy = this.widgets.tabs.connect('destroy', () => this.recreate_widgets());

            this.active_disconnect();

            for (const c of this.tabs.splice(0)) {
                this.tab_disconnect(c);
                const window = this.ext.windows.get(c.entity);
                if (window) this.add(window);
            }

            this.update_positions(this.rect);
            this.restack();

            const window = this.ext.windows.get(this.active);
            if (!window) return;

            this.active_reconnect(window.meta);
        }
    }

    remove_by_pos(idx: number) {
        const c = this.tabs[idx];
        if (c) this.remove_tab_component(c, idx);
    }

    remove_tab_component(c: Tab, idx: number) {
        if (!this.widgets) return;

        this.tab_disconnect(c);

        const b = this.buttons.get(c.button);
        if (b) {
            this.widgets.tabs.remove_child(b);
            b.destroy();
            this.buttons.remove(c.button);
        }

        this.tabs.splice(idx, 1);
    }

    /** Removes the tab associated with the entity */
    remove_tab(entity: Entity): null | number {
        if (!this.widgets) return null;

        if (this.prev_active && Ecs.entity_eq(entity, this.prev_active)) {
            this.prev_active = null;
            this.prev_active_id = 0;
        }

        let idx = 0;
        for (const c of this.tabs) {
            if (Ecs.entity_eq(c.entity, entity)) {
                this.remove_tab_component(c, idx);
                if (this.active_id > idx) {
                    this.active_id -= 1;
                }
                return idx;
            }
            idx += 1;
        }

        return null;
    }

    replace(window: ShellWindow) {
        if (!this.widgets) return;
        const c = this.tabs[this.active_id],
            actor = window.meta.get_compositor_private();
        if (c && actor) {
            this.tab_disconnect(c);

            if (Ecs.entity_eq(window.entity, this.active)) {
                this.active_connect(window.meta, window.entity);
                actor.show();
            } else {
                actor.hide();
            }

            this.watch_signals(this.active_id, c.button, window);
            this.buttons.get(c.button)?.set_title(window.title());
            this.activate(window.entity);
        }
    }

    /** Repositions the stack, arranging the stack's actors around the active window */
    reposition() {
        if (!this.widgets) return;

        const window = this.ext.windows.get(this.active);
        if (!window) return;

        const actor = window.meta.get_compositor_private();
        if (!actor) {
            this.active_disconnect();
            return;
        }

        actor.show();

        const parent = actor.get_parent();

        if (!parent) {
            return;
        }

        const stack_parent = this.widgets.tabs.get_parent();
        if (stack_parent) {
            stack_parent.remove_child(this.widgets.tabs);
        }

        parent.add_child(this.widgets.tabs);

        // Reposition actors on the screen, being careful about not displaying over maximized windows
        if (!window.meta.is_fullscreen() && !window.is_maximized() && !this.ext.maximized_on_active_display()) {
            parent.set_child_above_sibling(this.widgets.tabs, actor);
        } else {
            parent.set_child_below_sibling(this.widgets.tabs, actor);
        }
    }

    permitted_to_show(workspace?: number): boolean {
        const active_workspace = workspace ?? global.workspace_manager.get_active_workspace_index();
        const primary = global.display.get_primary_monitor();
        const only_primary = this.ext.settings.workspaces_only_on_primary();

        return active_workspace === this.workspace || (only_primary && this.monitor != primary);
    }

    reset_visibility(permitted: boolean) {
        let idx = 0;

        for (const c of this.tabs) {
            this.actor_exec(idx, c.entity, (actor) => {
                if (permitted && this.active_id === idx) {
                    actor.show();
                    return;
                }

                actor.hide();
            });

            idx += 1;
        }
    }

    /** Repositions the stack, and hides all but the active window in the stack */
    restack() {
        this.on_grab(() => {
            if (!this.widgets) return;

            const permitted = this.permitted_to_show();

            this.widgets.tabs.visible = permitted;

            if (permitted) this.reposition();

            this.reset_visibility(permitted);
        });
    }

    /** Changes visibility of the stack's actors */
    set_visible(visible: boolean) {
        if (!this.widgets) return;

        this.widgets.tabs.visible = visible;

        if (visible) {
            this.widgets.tabs.show();
        } else {
            this.widgets.tabs.hide();
        }
    }

    /** Updates the dimensions and positions of the stack's actors */
    update_positions(rect: Rectangular) {
        if (!this.widgets) return;

        this.rect = rect;

        // Container must fit the bar, whose thickness follows the gap setting.
        this.tabs_height = Math.max(TAB_HEIGHT * this.ext.dpi, this.pill_thickness());

        // Size each pill segment and center the whole strip with gaps;
        // it floats in the gap, taking no layout space.
        const segment_gap = this.segment_gap();
        let total_width = 0;
        this.tabs.forEach((tab, idx) => {
            const width =
                idx === this.active_id
                    ? SEGMENT_ACTIVE_WIDTH * this.ext.dpi
                    : SEGMENT_INACTIVE_WIDTH * this.ext.dpi;
            total_width += width + segment_gap;
            const button = this.buttons.get(tab.button);
            if (button) {
                button.width = width;
                button.height = this.tabs_height;
            }
        });
        if (this.tabs.length > 0) total_width -= segment_gap;

        // Center the strip vertically on the inner gap above the window
        // (the panel keeps outer == inner, so this holds at the screen
        // edge too). Bars are centered in the container, so they land on
        // the gap middle as well.
        const gap_half = this.ext.gap_inner_half;

        this.stack_rect = {
            x: rect.x + Math.max(0, (rect.width - total_width) / 2),
            y: rect.y - gap_half - this.tabs_height / 2,
            width: Math.min(total_width, rect.width),
            height: this.tabs_height + rect.height,
        };

        this.widgets.tabs.x = this.stack_rect.x;
        this.widgets.tabs.y = this.stack_rect.y;
        this.widgets.tabs.height = this.tabs_height;
        this.widgets.tabs.width = this.stack_rect.width;

        // Keep the visual gap identical to the measured one so the
        // strip width stays exact.
        const gap = segment_gap;
        try {
            (this.widgets.tabs as any).spacing = gap;
        } catch (_e) {}
        this.widgets.tabs.set_style(
            `background: transparent; border-width: 0; padding: 0; margin: 0; spacing: ${gap}px;`,
        );

        // Bar thickness also follows the gap setting, but bars are only
        // repainted on focus changes — refresh them here so a gap edit
        // resizes existing pills immediately.
        this.refresh_tab_colors();
    }

    private watch_signals(comp: number, button: number, window: ShellWindow) {
        const entity = window.entity;
        const widget = this.buttons.get(button);
        if (!widget) return;

        const c = this.tabs[comp];

        // Detach button signal if it's still attached
        if (c.button_signal) widget.disconnect(c.button_signal);

        // Connect tab-clicked signal
        c.button_signal = widget.connect('clicked', () => {
            this.activate(entity);
            this.window_exec(comp, entity, (window) => {
                const actor = window.meta.get_compositor_private();
                if (actor) {
                    actor.show();
                    window.activate(false);

                    this.reposition();
                }
            });
        });

        // Detach signals if they're still attached
        if (this.tabs[comp].signals) {
            for (const c of this.tabs[comp].signals) window.meta.disconnect(c);
        }

        // Attach new signals
        this.tabs[comp].signals = [
            window.meta.connect('notify::title', () => {
                this.window_exec(comp, entity, (window) => {
                    this.buttons.get(button)?.set_title(window.title());
                });
            }),

            window.meta.connect('notify::urgent', () => {
                this.window_exec(comp, entity, (window) => {
                    if (!window.meta.has_focus()) {
                        const urgent_button = this.buttons.get(button);
                        if (urgent_button) this.paint_tab(urgent_button, 'urgent', false);
                    }
                });
            }),
        ];
    }

    private window_changed() {
        this.ext.show_border_on_focused();
    }

    private actor_exec(comp: number, entity: Entity, func: (window: Clutter.Actor) => void) {
        this.window_exec(comp, entity, (window) => {
            func(window.meta.get_compositor_private() as Clutter.Actor);
        });
    }

    private window_exec(comp: number, entity: Entity, func: (window: ShellWindow) => void) {
        const window = this.ext.windows.get(entity);
        if (window && window.actor_exists()) {
            func(window);
        } else {
            const tab = this.tabs[comp];
            if (tab) this.tab_disconnect(tab);
        }
    }
}
