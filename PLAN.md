# Plan Sync - 2026-03-14 00:00 CET

## Latest User Request (verbatim)
"revert the latest wsl installations. you should now be able to access wsl directly without going through windows. but ive always had node, so dont want it to break. moreover, fix all build issues and warnings. i got these: ⨯ useSearchParams() should be wrapped in a suspense boundary at page \"/no-access\". Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
    at Q (/vercel/path0/.next/server/chunks/ssr/node_modules_next_920e7746._.js:2:2111)
    at o (/vercel/path0/.next/server/chunks/ssr/node_modules_next_920e7746._.js:4:5314)
    at n (/vercel/path0/.next/server/chunks/ssr/_443d49ab._.js:1:1942)
    at an (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:84360)
    at ai (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:86179)
    at al (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:107953)
    at as (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:105368)
    at aa (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:84712)
    at ai (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:86228)
    at ai (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:104708)
    at al (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:107953)
    at as (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:105368)
    at am (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:112882)
    at au (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:109985)
    at al (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:108231)
    at as (/vercel/path0/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:105368)
Error occurred prerendering page \"/no-access\". Read more: https://nextjs.org/docs/messages/prerender-error
Export encountered an error on /no-access/page: /no-access, exiting the build.
⨯ Next.js build worker exited with code: 1 and signal: null
Error: Command \"npm run build\" exited with 1"

## Actionable Tasks
1. Verify current WSL Node/npm binaries and package provenance (NodeSource vs distro vs nvm).
2. Revert only the recent WSL toolchain changes introduced during prior debugging, preserving a working Node install.
3. Reinstall dependencies in the project using the stable local WSL Node/npm path.
4. Fix Next.js prerender issue on `/no-access` by wrapping `useSearchParams()` usage in `Suspense` or equivalent supported pattern.
5. Run full project checks (`npm run build`, lint/type where configured) and resolve all warnings/errors that surface.
6. Re-run checks to confirm clean build output.

## Blockers / Assumptions
- Assumption: Reverting the recent installs means undoing apt/NodeSource changes from prior turn, not removing user’s original Node setup.
- Potential blocker: original Node source (e.g., nvm-managed) may need PATH restoration after package changes.
