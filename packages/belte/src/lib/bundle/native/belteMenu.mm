// belte's native macOS shim, compiled into the same dylib as the vendored
// webview header. The upstream webview library creates a bare NSWindow with no
// application menu bar, so a non-bundled webview app has no Quit item and the
// standard Edit shortcuts (Cmd-C/V/X/A/Z) never reach the WKWebView. This
// installs the conventional menu so the window behaves like a normal Mac app,
// the built-in File menu (Start / Disconnect), and the bundle's custom menus
// whose items emit events into the page.
#import <Cocoa/Cocoa.h>
#include <cstdlib>
#include <cstring>

// webview C entry points, also in this dylib — used to drive the live window.
extern "C" int webview_navigate(void *w, const char *url);
extern "C" int webview_eval(void *w, const char *js);
// Marshals a callback onto the UI thread; the only safe way to touch the window
// from another thread (the launcher runs its control server off the main thread).
extern "C" int webview_dispatch(void *w, void (*fn)(void *w, void *arg), void *arg);

// Exported despite -fvisibility=hidden so belte's FFI layer can resolve it.
#define BELTE_EXPORT __attribute__((visibility("default")))

/*
Process-wide connection flag the menu validation reads. The launcher owns every
connection transition and flips this via belte_set_connected, so the Server menu
items enable/disable correctly: menu validation runs each time a menu opens, so
just storing the bool is enough — no explicit revalidation needed.
*/
static int g_belte_connected = 0;

// Roles for the built-in Server menu items, parsed from each item's `role` field.
// `none` is any non-Server navigate item (always enabled).
typedef enum {
    BelteRoleNone = 0,
    BelteRoleStart,
    BelteRoleDisconnect,
} BelteRole;

// Sets the connection flag the Server menu's validateMenuItem: reads.
extern "C" BELTE_EXPORT void belte_set_connected(int connected) {
    g_belte_connected = connected;
}

// Runs on the UI thread via webview_dispatch: navigate, then free the copy made
// below (the original buffer is long gone — the dispatch is asynchronous).
static void belteDispatchNavigate(void *w, void *arg) {
    char *url = (char *)arg;
    webview_navigate(w, url);
    free(url);
}

/*
Navigate the live window to `url` from any thread. The launcher's control server
runs off the main thread, so it can't call webview_navigate (a Cocoa/UI call)
directly; this hops onto the UI thread via webview_dispatch. The URL is copied
synchronously here because the dispatch runs later, after the caller's buffer is
gone — belteDispatchNavigate frees the copy once it has navigated.
*/
extern "C" BELTE_EXPORT void belte_request_navigate(void *w, const char *url) {
    webview_dispatch(w, belteDispatchNavigate, strdup(url));
}

// Maps a JSON `role` string to its enum; unknown/absent → none.
static BelteRole roleFromString(NSString *role) {
    if ([role isEqualToString:@"start"]) {
        return BelteRoleStart;
    }
    if ([role isEqualToString:@"disconnect"]) {
        return BelteRoleDisconnect;
    }
    return BelteRoleNone;
}

// Builds a JS string literal for `value`, safely escaped via NSJSONSerialization.
static NSString *jsString(NSString *value) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value
                                                  options:NSJSONWritingFragmentsAllowed
                                                    error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}

/*
Action target for a menu item. Owns the webview handle so a click can drive the
live window: a `navigate` item repoints the window at a URL (the Server menu's
Start/Disconnect, gated by `role`), a `emit` item dispatches a belte:menu
event into the page. Lives for the whole process (NSMenuItem does not retain its
target), matching the never-released menu objects below.
*/
@interface BelteMenuAction : NSObject {
@public
    void *webviewHandle;
    NSString *navigateUrl;  // target URL for a navigate item; nil otherwise
    NSString *emitName;     // event name for an emit item; nil otherwise
    BelteRole role;         // gating role for a Server navigate item; none otherwise
}
- (void)navigateTo:(id)sender;
- (void)emit:(id)sender;
- (BOOL)validateMenuItem:(NSMenuItem *)item;
@end

@implementation BelteMenuAction
// Points the live webview at this item's URL (already on the UI thread here).
- (void)navigateTo:(id)sender {
    if (navigateUrl != nil) {
        webview_navigate(webviewHandle, [navigateUrl UTF8String]);
    }
}

// Dispatches a belte:menu CustomEvent (detail `{ name }`) into the page, so the
// app's own code handles it — including computing args for a parameterised call.
- (void)emit:(id)sender {
    NSString *js = [NSString
        stringWithFormat:
            @"window.dispatchEvent(new CustomEvent('belte:menu',{detail:{name:%@}}))",
            jsString(emitName)];
    webview_eval(webviewHandle, [js UTF8String]);
}

/*
Drives the enabled state per connection. Server navigate items follow the truth
table — Start only when disconnected, Disconnect only when connected — emit items
only fire into a loaded page (so connected), and plain navigate items (role none)
are always enabled.
*/
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (navigateUrl != nil) {
        switch (role) {
            case BelteRoleStart:
                return g_belte_connected == 0;
            case BelteRoleDisconnect:
                return g_belte_connected != 0;
            default:
                return YES;
        }
    }
    if (emitName != nil) {
        return g_belte_connected != 0;
    }
    return YES;
}
@end

// Builds one bundle submenu from its JSON description and items, or nil when
// the description is malformed. Each item is a separator, a `navigate` item
// (optionally roled), or an `emit` item.
static NSMenu *buildBundleMenu(NSDictionary *menuDef, void *webview_handle) {
    if (![menuDef isKindOfClass:[NSDictionary class]]) {
        return nil;
    }
    NSMenu *menu = [[NSMenu alloc] initWithTitle:menuDef[@"label"] ?: @""];
    for (NSDictionary *item in menuDef[@"items"]) {
        if ([item[@"separator"] boolValue]) {
            [menu addItem:[NSMenuItem separatorItem]];
            continue;
        }
        NSString *navigate = item[@"navigate"];
        NSString *emitName = item[@"emit"];
        BelteMenuAction *target = [[BelteMenuAction alloc] init];
        target->webviewHandle = webview_handle;
        SEL action;
        if ([navigate isKindOfClass:[NSString class]]) {
            target->navigateUrl = [navigate copy];
            target->role = roleFromString(item[@"role"]);
            action = @selector(navigateTo:);
        } else if ([emitName isKindOfClass:[NSString class]]) {
            target->emitName = [emitName copy];
            action = @selector(emit:);
        } else {
            continue;
        }
        NSMenuItem *menuItem = [menu addItemWithTitle:(item[@"label"] ?: @"")
                                               action:action
                                        keyEquivalent:(item[@"shortcut"] ?: @"")];
        [menuItem setTarget:target];
    }
    return menu;
}

/*
Builds and installs the macOS main menu on the shared application: App, File (the
launcher's built-in Start/Disconnect), Edit, the bundle's custom menus, and
Window.

Safe to call after webview_create — which has already created the
NSApplication — and must run before webview_run so the menu is present when the
run loop starts. `webview_handle` is the value returned by webview_create,
captured so the menu can drive it. `config_json` is a JSON object
`{ "appName": string, "fileMenu"?: { label, items }, "menu"?: [{ label, items }] }`,
where each item is `{ separator: true }`, `{ label, shortcut?, navigate, role? }`,
or `{ label, shortcut?, emit }`; pass NULL for the standard menus only.

Compiled without ARC (matching the webview header's manual memory model): the
menu objects and action targets intentionally live for the whole process, so
the +1 alloc counts are never released.
*/
extern "C" BELTE_EXPORT void belte_install_app_menu(void *webview_handle,
                                                    const char *config_json) {
    @autoreleasepool {
        NSDictionary *config = nil;
        if (config_json) {
            NSData *data = [[NSString stringWithUTF8String:config_json]
                dataUsingEncoding:NSUTF8StringEncoding];
            id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if ([parsed isKindOfClass:[NSDictionary class]]) {
                config = parsed;
            }
        }
        NSApplication *app = [NSApplication sharedApplication];
        NSString *appName = config[@"appName"] ?: @"App";

        NSMenu *mainMenu = [[NSMenu alloc] init];

        // Application menu — the bold first menu. Its title is ignored by macOS
        // (the process/bundle name wins), but its items are what users reach.
        NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:appMenuItem];
        NSMenu *appMenu = [[NSMenu alloc] init];
        [appMenuItem setSubmenu:appMenu];

        [appMenu addItemWithTitle:[@"About " stringByAppendingString:appName]
                           action:@selector(orderFrontStandardAboutPanel:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:[@"Hide " stringByAppendingString:appName]
                           action:@selector(hide:)
                    keyEquivalent:@"h"];
        NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Hide Others"
                                                    action:@selector(hideOtherApplications:)
                                             keyEquivalent:@"h"];
        [hideOthers setKeyEquivalentModifierMask:(NSEventModifierFlagCommand |
                                                  NSEventModifierFlagOption)];
        [appMenu addItemWithTitle:@"Show All"
                           action:@selector(unhideAllApplications:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:[@"Quit " stringByAppendingString:appName]
                           action:@selector(terminate:)
                    keyEquivalent:@"q"];

        // File menu — the launcher's Start/Disconnect, in the conventional
        // slot right after the App menu and before Edit. Built from the same item
        // shape as the custom menus, so `role` gating applies.
        NSMenu *fileMenu = buildBundleMenu(config[@"fileMenu"], webview_handle);
        if (fileMenu) {
            NSMenuItem *fileMenuItem = [[NSMenuItem alloc] init];
            [mainMenu addItem:fileMenuItem];
            [fileMenuItem setSubmenu:fileMenu];
        }

        // Edit menu — the actions resolve against the first responder, which is
        // the WKWebView, so Cmd-Z/X/C/V/A operate on the page's text fields.
        NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:editMenuItem];
        NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
        [editMenuItem setSubmenu:editMenu];
        [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
        NSMenuItem *redo = [editMenu addItemWithTitle:@"Redo"
                                               action:@selector(redo:)
                                        keyEquivalent:@"z"];
        [redo setKeyEquivalentModifierMask:(NSEventModifierFlagCommand |
                                            NSEventModifierFlagShift)];
        [editMenu addItem:[NSMenuItem separatorItem]];
        [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
        [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
        [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
        [editMenu addItemWithTitle:@"Select All"
                            action:@selector(selectAll:)
                     keyEquivalent:@"a"];

        // Bundle's menus, inserted between Edit and Window — the launcher passes
        // its built-in Server menu first, followed by the app's custom menus.
        for (NSDictionary *menuDef in config[@"menu"]) {
            NSMenu *bundleMenu = buildBundleMenu(menuDef, webview_handle);
            if (bundleMenu) {
                NSMenuItem *bundleMenuItem = [[NSMenuItem alloc] init];
                [mainMenu addItem:bundleMenuItem];
                [bundleMenuItem setSubmenu:bundleMenu];
            }
        }

        // Window menu — Minimize/Zoom/Close, registered so macOS tracks the
        // app's windows in it automatically.
        NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:windowMenuItem];
        NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
        [windowMenuItem setSubmenu:windowMenu];
        [windowMenu addItemWithTitle:@"Minimize"
                              action:@selector(performMiniaturize:)
                       keyEquivalent:@"m"];
        [windowMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
        [windowMenu addItem:[NSMenuItem separatorItem]];
        [windowMenu addItemWithTitle:@"Close"
                              action:@selector(performClose:)
                       keyEquivalent:@"w"];
        [app setWindowsMenu:windowMenu];

        [app setMainMenu:mainMenu];
    }
}
