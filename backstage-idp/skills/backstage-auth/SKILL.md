---
name: backstage-auth
description: Configure and debug Backstage authentication — auth providers, sign-in resolvers, the app SignInPage, service-to-service tokens, and the hardened OAuth redirect-URI and CIMD allowlists.
when_to_use: add an auth provider, sign-in fails, user not found, unable to resolve user identity, origin not allowed, callback URL mismatch, session lost on reload, service-to-service token, external access token, CIMD, invalid_client, redirect URI rejected after upgrade.
---

# Backstage Authentication and Identity

Wire an identity provider into Backstage, map its users onto catalog entities, and tell apart the five ways sign-in fails.

## Preconditions

- Release line from `backstage.json`. Backend generation: `createBackend()` + `backend.add(import('@backstage/plugin-auth-backend'))` is the new backend system; a `createRouter` in `packages/backend/src/plugins/auth.ts` is legacy — migrate it before adding auth modules.
- Frontend generation: `SignInPageBlueprint` from `@backstage/plugin-app-react` + `createFrontendModule` is NFS; a `components: { SignInPage }` option on `createApp` from `@backstage/app-defaults` is legacy.
- Which provider is meant for **sign-in** and which only **delegates access to third-party APIs**. These are different jobs on the same config tree and most misconfigurations start here.
- Exact factory and resolver signatures (`createOAuthProviderFactory`, `createProxyAuthProviderFactory`, `authProvidersExtensionPoint`, the `ctx` helpers) read from the installed `@backstage/plugin-auth-node` types, not from memory.
- Anything requiring a new OAuth app registration, a client-secret rotation, or an IdP-side change is external mutation: stop and return a BLOCKED report with the exact redirect URI and scopes needed.

## Procedure

1. **Inventory before changing.** Read every `auth:` block across `app-config.yaml`, `app-config.production.yaml` and local overrides, the auth imports in `packages/backend/src/index.ts`, and the app's sign-in component. Print the effective merge with `yarn backstage-cli config:print --lax`. Note `auth.environment` — only the provider sub-block matching it is loaded.
2. **Classify each provider.** A provider is a sign-in provider only if it has `signIn.resolvers` in config or a `signInResolver` in code. Providers used purely for API delegation (SCM tokens, Google APIs) are configured under `auth.providers.<id>.<env>` with client credentials and **no** resolver, and are consumed in the frontend through their `*AuthApiRef`. Adding a resolver to a delegation-only provider silently creates a second sign-in path.
3. **Configure the provider block and register its module.**
   - Credentials live at `auth.providers.<id>.<env>.clientId` / `clientSecret`, sourced from env vars.
   - `callbackUrl` is optional and defaults to `<backend.baseUrl>/api/auth/<id>/handler/frame`. Set it explicitly only when an ingress rewrites the path.
   - Add `backend.add(import('@backstage/plugin-auth-backend-module-<id>-provider'))` after `@backstage/plugin-auth-backend`. Confirm the package name and its exports from the installed package; provider ids and module names do not always match the vendor's name.
4. **Ingest users and groups before wiring a resolver.** Every built-in resolver is a catalog lookup and cannot work against an empty catalog. Use an org provider — `@backstage/plugin-catalog-backend-module-github-org` (config under `catalog.providers.githubOrg`), or the MS Graph / GitLab / LDAP equivalents — or a custom `EntityProvider` (`backstage-catalog`). Verify the `User` entities exist before touching sign-in config.
5. **Choose exactly one sign-in resolver**, in the provider's `signIn.resolvers` list.
   - Provider-agnostic built-ins: `emailMatchingUserEntityProfileEmail`, `emailLocalPartMatchingUserEntityName`. Provider-specific ones such as GitHub's `usernameMatchingUserEntityName` are listed in that provider's doc page.
   - Always set `allowedDomains` on `emailLocalPartMatchingUserEntityName`; without it any account whose email local part matches an entity name can sign in.
   - More than one resolver, or more than one sign-in provider, is acceptable only when they provably resolve the same human to the same entity ref. Otherwise it is an account-takeover path.
6. **Write a custom resolver only when no built-in fits.**
   - Backend module with `pluginId: 'auth'` (exact) and a unique `moduleId`, registering through `authProvidersExtensionPoint` with `providerId` matching the config key exactly.
   - Pass `signInResolver` to `createOAuthProviderFactory({ authenticator, ... })`; proxy-based providers use the proxy factory instead. Read both signatures from the installed `@backstage/plugin-auth-node`.
   - Remove `signIn.resolvers` from config first: **config resolvers take priority over code resolvers**, so leaving them in makes the module dead code.
   - Prefer `ctx.signInWithCatalogUser`. Drop to `ctx.findCatalogUser` + `ctx.resolveOwnershipEntityRefs` + `ctx.issueToken({ claims: { sub, ent } })` only for custom ownership. `resolveOwnershipEntityRefs` includes only groups with a direct `MEMBER_OF` relation by default — the usual cause of missing ownership in nested group trees (`backstage-permissions`).
7. **Use `profileTransform` on the same factory for authorization and display fields.** That is where you validate the upstream response, shape `displayName` / `email` / `picture`, and throw to reject a user outright — not the resolver.
8. **Wire the app-side sign-in page.**
   - NFS: `SignInPageBlueprint.make({ params: { loader: async () => props => <SignInPage {...props} provider={{ id, title, message, apiRef }} /> } })`, registered via `createFrontendModule({ pluginId: 'app', extensions: [signInPage] })`.
   - `SignInPage` and `ProxiedSignInPage` come from `@backstage/core-components`; the `providers` array form accepts `'guest'` alongside provider configs, and can be selected conditionally off `configApi.getString('auth.environment')`.
   - Behind an auth proxy (AWS ALB, Azure EasyAuth, Cloudflare Access, Google IAP, OAuth2 Proxy) use `ProxiedSignInPage provider="<id>"`; it only calls `/refresh`. Extra provider headers go through its `headers` prop, which may be sync or async.
   - `enableExperimentalRedirectFlow: true` at the config root replaces the popup with a full redirect.
9. **Keep guest access out of production.** `auth.providers.guest: {}` is development-only; `userEntityRef` and `ownershipEntityRefs` customise the identity. `dangerouslyAllowOutsideDevelopment: true` is required anywhere else — never set it without explicit authorization.
10. **Attach tokens correctly in frontend plugin clients.**
    - Calls to Backstage backends: use `fetchApiRef` from `@backstage/core-plugin-api`, which adds the Backstage token itself. Do not read `identityApiRef.getCredentials()` and build the header by hand. Resolve base URLs through `discoveryApiRef`.
    - Calls to third-party services: take a short-lived token from that provider's `*AuthApiRef` (`githubAuthApiRef` and friends) with the scopes actually needed, or from `scmAuthApiRef` when the target host varies. Extend SCM coverage with `ScmAuth.merge(ScmAuth.forGithub(...))` in the app's API factories.
11. **Use the auth core services for backend-to-backend calls.**
    - `httpAuth.credentials(req)` turns an incoming request into credentials; `auth.getPluginRequestToken({ onBehalfOf, targetPluginId })` mints the outgoing token; `await auth.getOwnServiceCredentials()` supplies `onBehalfOf` for self-initiated work such as scheduled tasks.
    - Mint a token immediately before each request. Never store or reuse one.
    - Narrow principals with `auth.isPrincipal(credentials, 'user' | 'service')`.
    - In the new backend system ownership refs are not read off the token's `ent` claim; get them from the `userInfo` service.
12. **Grant non-browser callers access through `backend.auth.externalAccess`.**
    - `type: static` with `options.token` and `options.subject`; generate the token with `node -p 'require("crypto").randomBytes(24).toString("base64")'`.
    - `type: jwks` with `url`, `issuer`, `algorithm`, `audience`, `subjectPrefix`; verified subjects get an `external:` prefix.
    - Always add `accessRestrictions` (plugin, permission, permission attribute). An entry without them has unlimited access to every plugin.
    - `backend.auth.pluginKeyStore` static ES256 keys are for multi-replica deployments needing stable plugin-to-plugin signing.
13. **Treat the OAuth allowlists as hardened.** These apply where Backstage acts as an OAuth server for MCP clients.
    - CIMD is stable: `auth.clientIdMetadataDocuments.enabled: true`, with optional `allowedClientIdPatterns` and `allowedRedirectUriPatterns`. `auth.experimentalClientIdMetadataDocuments` survives as a deprecated alias.
    - The block belongs under the **top-level `auth:`**, never `backend.auth:`.
    - Patterns are matched per URL component, not against the whole URL string. Wildcards do not cross host or path boundaries; a pattern without an explicit protocol is rejected; redirect URIs with embedded credentials are always rejected; a wildcard port no longer implies any path, so write `http://localhost:*/*`, `http://127.0.0.1:*/*`, `http://[::1]:*/*`.
    - Setting `allowedClientIdPatterns` replaces the built-in Claude and VS Code defaults entirely; the Backstage CLI client stays allowed regardless.
    - CIMD requires the new frontend system plus the `@backstage/plugin-auth` frontend plugin in `packages/app`. On a legacy app it cannot work at all.
    - `auth.experimentalDynamicClientRegistration` (DCR) is deprecated, logs a startup warning, and must not be used for new setups. Migrate existing ones to CIMD.
14. **Pin signing keys when tokens must survive restarts.** `auth.keyStore.provider: static` with ES256 keys (`privateKeyFile` in PKCS#8, `publicKeyFile` in SPKI; the first key signs, later keys only validate, which is what makes rotation safe). The default is ephemeral in-memory keys.

## Verification

- `yarn backstage-cli config:check --strict` — catches the `signIn` indentation and unknown-key mistakes that produce "not configured to support sign-in". Then `yarn backstage-cli config:print --lax` to confirm env-var substitution actually resolved (env vars are not read from `.env` files).
- `yarn start-backend` and read the startup log: `Configuring provider, <id>` means the block was loaded; `Skipping <id> auth provider, ...` means the config did not match `auth.environment` or is incomplete.
- Step through the flow manually instead of fighting the popup: open `http://localhost:7007/api/auth/<provider>/start?env=development` (the `env` query param is required; some providers also need `scope`). A successful run lands on the empty `/handler/frame` page — read `authResponse` from its source or the console.
- Decode the issued token with `atob(token.split('.')[1])` and check `sub` is a full entity ref (`user:default/jane`, not `jane`), then confirm that entity resolves: `GET /api/catalog/entities/by-name/user/default/<name>`.
- For external access, `curl -H "Authorization: Bearer <token>" <backend>/api/<plugin>/...` — a 401 means the token or its `accessRestrictions` is wrong, not the plugin.
- For MCP/CIMD, confirm the discovery document advertises the expected endpoints (including `revocation_endpoint` when CIMD or DCR is on) before blaming the client.

## Failure modes

Triage sign-in by *where* the flow stopped: the IdP's own error page (callback/scope problem), the `/handler/frame` result (resolver problem), or a later `/refresh` call (cookie/session problem). Establish that first; the error text alone is ambiguous.

- **"The '<provider>' provider is not configured to support sign-in".** No resolver reached the provider: `signIn.resolvers` missing, misindented, or placed on the wrong environment block; or a code resolver that never registered. Auth itself succeeded. `config:check --strict` finds most of these.
- **"Failed to sign-in, unable to resolve user identity" / "User not found".** The resolver ran and found no matching catalog user. Distinguish from the previous case by the point of failure: this one happens *after* the IdP round trip. Query the catalog for the expected `User` entity before touching auth config — the fix is org ingestion, not a looser resolver. `dangerouslyAllowSignInWithoutUserInCatalog` is a local-dev escape hatch only; users signed in that way have no entity and end up with guest-level permissions.
- **Ambiguous identity.** Two catalog users match the resolver key (same email on two entities, same local part in two namespaces), or two sign-in providers map one human to two different entity refs. Symptom is intermittent: ownership and permissions flip between sessions. Compare the `sub` claim across sign-ins with each provider; fix by de-duplicating the catalog or aligning both resolvers.
- **Callback URL mismatch.** The error page comes from the IdP, in the popup, before Backstage logs anything — no backend log line at all is the tell. The registered redirect URI must equal `<backend.baseUrl>/api/auth/<id>/handler/frame` exactly, including scheme, port and any path prefix added by an ingress.
- **"Login failed; caused by NotAllowedError: Origin '...' is not allowed".** `app.baseUrl` does not match the origin in the browser's address bar; the flow posts its result to a single configured origin by design. Align `app.baseUrl` first; `auth.experimentalExtraAllowedOrigins` (glob list) is an experimental fallback for genuinely multi-origin deployments.
- **Session lost on reload, or endless re-login.** This is the `/refresh` call, not sign-in — the sign-in itself succeeded. Filter the network tab on `/refresh` and look only at the request for the provider under investigation; failing `/refresh` calls for other providers are normal session probes and mean nothing. Then distinguish:
  - Cookie never sent — the refresh token is an HTTP-only cookie scoped to `/api/auth/<provider>`, so an ingress that rewrites that path prefix, or a proxy that strips cookies, kills it.
  - Cookie present but rejected — cross-site app and backend domains (SameSite) or plain HTTP in production (Secure).
  - 4xx with no cookie complaint — `/refresh` and `/logout` require an `X-Requested-With` header as CSRF protection; some proxies drop it.
  - Works on one replica, fails on the next — default signing keys are ephemeral and per-instance. Configure `auth.keyStore` static keys.
- **Popup completes but nothing happens in the main window.** The nonce is set both in a short-lived cookie and in the OAuth state and must match, and the result is posted to a single configured origin. A host change mid-flow, or an origin mismatch, silently ends the flow at `/handler/frame`.
- **A pattern that worked before an upgrade is now refused.** Almost always the hardening behaving correctly: a pattern with no explicit protocol, a wildcard crossing a host or path boundary, `http://localhost:*` where `http://localhost:*/*` is meant, or a redirect URI carrying embedded credentials. Rewrite the pattern to be component-exact; do not broaden it.
- **`invalid_client` from an MCP client.** In order: config placed under `backend.auth` instead of top-level `auth`; a redirect URI that needs an explicit `allowedRedirectUriPatterns` entry; a stale cached client in the editor (VS Code: `Authentication: Remove Dynamic Authentication Providers`); or the app still on the legacy frontend system, which cannot serve CIMD or DCR at all — fall back to a static external-access token there.
- **Everything works but nothing is protected.** `backend.auth.dangerouslyDisableDefaultAuthPolicy: true` left in a config file makes every backend route accept unauthenticated requests. Grep for it whenever auth "just works" without a resolver.

## Do not

- Do not attach a sign-in resolver to a provider that exists only to delegate third-party API access.
- Do not broaden `allowedRedirectUriPatterns` / `allowedClientIdPatterns`, or add a catch-all wildcard, to clear a post-upgrade rejection (`backstage-upgrade`).
- Do not set `dangerouslyAllowSignInWithoutUserInCatalog`, `dangerouslyAllowOutsideDevelopment`, or `dangerouslyDisableDefaultAuthPolicy` in any non-development config without explicit authorization.
- Do not leave `signIn.resolvers` in config while shipping a custom code resolver — config wins.
- Do not build `Authorization` headers by hand in frontend clients, and do not store or reuse a plugin request token.
- Do not create or modify OAuth app registrations, rotate client secrets, or commit credentials; return BLOCKED with the exact redirect URI and scopes instead.
- Do not adopt Dynamic Client Registration for new deployments, and do not place its config or CIMD config under `backend.auth`.
