---
name: backstage-theming
description: Customize how a Backstage portal looks — BUI design tokens, custom themes, light/dark, branding and logos, component definition overrides, and the two theme systems that coexist.
when_to_use: 'Any visual or design customization of Backstage. "apply our brand colours", "change the theme", "custom logo", "dark mode is broken", "our sidebar looks wrong", "override a component style", "design tokens", "--bui- variables", "the theme does not apply to some pages", "add a custom homepage", "white-label our portal", createUnifiedTheme, ThemeBlueprint, BUIProvider.'
---

# Backstage theming and design

Two theme systems run side by side in a current Backstage app, and most theming
bugs are one of them being styled while the other is not. Decide which surface
you are changing before you change anything.

## Preconditions

- Frontend generation known. **NFS**: `createApp` from `@backstage/frontend-defaults`,
  themes registered as extensions via `ThemeBlueprint` from `@backstage/plugin-app-react`.
  **Legacy**: `createApp` from `@backstage/app-defaults` with a `themes` array option.
  The theme objects are nearly identical; only registration differs. Run
  `backstage-repo-discovery` if unsure.
- Which system owns the pixels you are changing:
  - `@backstage/ui` ("BUI") — CSS custom properties, `--bui-*`. Newer surfaces:
    entity cards, headers, tables, form controls.
  - `@backstage/theme` + Material UI — a JS theme object. Older plugin pages and
    every third-party plugin that has not migrated.
  A portal on a current line contains both. Styling one and declaring victory is
  the single most common outcome here.
- `packages/app/src/index.tsx` imports `@backstage/ui/css/styles.css`. Without it
  no BUI token has a value and every BUI component renders unstyled.
- Exact theme factory signatures (`createUnifiedTheme`, `createBaseThemeOptions`,
  `genPageTheme`, and the `ThemeBlueprint` input shape) read from the installed
  `@backstage/theme` and `@backstage/plugin-app-react` types, not from memory.
- Brand assets available as real files. Do not invent colour values; ask for the
  brand tokens or read them from an existing asset, and record the source.

## Procedure

1. **Inventory what is themed today.** `rg -n "createUnifiedTheme|UnifiedThemeProvider|ThemeBlueprint|themes:" packages/app/src`
   and `rg -n "\-\-bui-" packages plugins`. Note whether a custom theme exists at
   all — a default `create-app` has none, and adding the first one is a different
   job from editing an existing one.
2. **Change BUI tokens first, in one place.** Override the custom properties on
   `:root` in a stylesheet imported after `@backstage/ui/css/styles.css`. The
   families are `--bui-bg-*`, `--bui-fg-*`, `--bui-gray-*`, `--bui-accent-*`,
   `--bui-border-*`, `--bui-radius-*`, `--bui-font-*`, `--bui-space-*`, plus the
   status families `--bui-positive-*`, `--bui-negative-*`, `--bui-warning-*` and
   `--bui-announcement-*`. Read the shipped `dist/css/styles.css` in the installed
   `@backstage/ui` for the exact names on your version; they are added to between
   minors.
3. **Do light and dark together or neither.** BUI scopes its palette with a
   `data-theme` attribute on a root element. An override written only against
   `:root` leaks the light value into dark mode, which looks like "dark mode is
   broken" and is really a missing scoped override. Set every colour token under
   both selectors.
4. **Then the Material UI side.** `createUnifiedTheme` from `@backstage/theme`
   produces a theme both v4 and v5 consumers can use; `createUnifiedThemeFromV4`
   adapts an existing v4 theme rather than rewriting it. Compose from
   `createBaseThemeOptions` and `palettes.light` / `palettes.dark` instead of
   building a palette by hand — the defaults carry the page gradients and status
   colours plugins expect to exist.
5. **Set page themes deliberately.** `genPageTheme({ colors, shape })` builds the
   header gradient per page type (`home`, `tool`, `service`, `website`,
   `library`, `app`, `apis`, `documentation`, `other`). Omitting a page type
   leaves it on the default, which is the usual cause of "one page still has the
   old header".
6. **Register the theme for your generation.**
   - NFS: create a theme extension with `ThemeBlueprint` from
     `@backstage/plugin-app-react` and add it to a frontend module. Read the
     blueprint's parameter names from the installed package before writing it.
   - Legacy: pass `themes: [{ id, title, variant, icon, Provider }]` to
     `createApp`, with `Provider` rendering `UnifiedThemeProvider`.
   Registering a theme does not select it: users pick per account in settings,
   so verify by switching, not by loading the page once.
7. **Keep `BUIProvider` in the tree, inside the router.** It supplies the
   analytics context and, when it detects a router, installs react-aria's
   `RouterProvider` so BUI navigation resolves client-side. Outside the router it
   silently degrades to no routing integration.
8. **Override a component's look through its definition, not its internals.**
   Each BUI component exports a `<Name>Definition` alongside it. Prefer a token
   change, then a definition override, then a wrapper component. Never target
   BUI's generated class names — they are not a public API and change without a
   major.
9. **Brand the app shell.** Logos live in `packages/app/src/modules/nav/`
   (`LogoFull.tsx`, `LogoIcon.tsx`, `SidebarLogo.tsx`) in a current scaffold.
   Replace the SVG contents, keep the components' exported names and their
   `viewBox`-driven sizing, and check the collapsed sidebar as well as expanded.
10. **Set `app.title` and `organization.name`** in `app-config.yaml`. They drive
    the browser title and several page headers, and a rebrand that misses them
    leaves the old name in the tab.
11. **Check contrast before shipping.** Brand colours frequently fail WCAG AA on
    Backstage's surfaces, particularly accent-on-surface for links and the status
    families. Fix the token, not the component.

## Verification

- `yarn tsc` and `yarn lint` clean; a theme is TypeScript and breaks the build
  when a factory signature moved.
- `yarn start`, then switch theme in user settings both ways and confirm the
  palette changes on: an entity page, a TechDocs page, the search results page,
  and one third-party plugin page. Those four cover both theme systems.
- Toggle the OS to dark and reload with no explicit selection, to catch a missing
  `data-theme` scoped override.
- Inspect one BUI element and confirm the computed value of the token you changed
  is yours, not the default — this distinguishes "override not loaded" from
  "override loaded and wrong".
- Collapsed and expanded sidebar both render the logo without clipping.
- No hard-coded hex remains: `rg -n "#[0-9a-fA-F]{6}" packages/app/src` should
  return only your token definitions.

## Failure modes

- **Half the portal is themed and half is not.** The two theme systems. BUI
  tokens do not reach Material UI components and a unified theme does not reach
  BUI. Check both before concluding the theme "did not apply".
- **Dark mode shows light colours.** Overrides written against `:root` only. BUI
  scopes its palette by `data-theme`; an unscoped override wins in both modes.
- **Every BUI component renders unstyled.** `@backstage/ui/css/styles.css` is not
  imported, or is imported before something that resets it. It belongs in
  `packages/app/src/index.tsx`.
- **The theme appears in settings but nothing changes when selected.** The
  provider is registered but not wrapping content, or two theme providers are
  nested and the inner one wins.
- **BUI links cause a full page reload.** No `BUIProvider`, or it sits outside the
  router — it only installs the routing integration when it detects a router
  context.
- **A third-party plugin ignores the theme entirely.** It ships its own styles or
  pins its own Material UI. Confirm with `yarn why @material-ui/core`; a
  duplicate copy has its own theme context and cannot see yours.
- **Styles break after an upgrade with no code change.** A BUI token was renamed
  or a component's internal class names changed. Re-read the installed
  `styles.css`; class-name targeting is the usual root cause and the fix is to
  stop targeting them.
- **Colours look right and fail accessibility review.** Brand palettes are chosen
  against white marketing pages, not against portal surfaces. Check contrast on
  the token, before it propagates.

## Do not

- Do not target `@backstage/ui` generated class names or internal DOM structure.
- Do not fork a Backstage component to restyle it when a token or a definition
  override reaches the same result.
- Do not invent brand colour values. If they are not in the repository or the
  task, return a BLOCKED report naming exactly which tokens you need.
- Do not add a second Material UI major to make a component match; two copies
  produce two theme contexts and unpredictable wins.
- Do not put theme overrides in a plugin package — a theme is app-level, and a
  plugin that styles globally breaks every other adopter.
- Do not use `!important` to win a specificity fight; it moves the problem to
  whoever themes next.
- Do not change a token value to fix one component's spacing. Tokens are global;
  fix the component.
