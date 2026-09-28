# Start the complete local Spectra environment

From the repository root, run:

```powershell
npm run local:start:all
```

This starts or reuses local instance 1 in development mode. The existing local stack is responsible for the Next dev server, the collaboration gateway and local Convex. The launcher waits for all three readiness checks before it starts or reuses the Bridge, then waits for the Bridge health endpoint too.

The command prints an explicit confirmation containing the Convex instance name, web URL, gateway URL and whether the Bridge is already paired or is listening and ready to be paired from Settings → Files and devices. Convex can take several minutes to restore its local deployment; the default readiness window is 15 minutes.

Useful variants:

```powershell
# Show options without starting anything
npm run local:start:all -- --help

# Start the stack without the Bridge
npm run local:start:all -- --no-bridge

# Build the release Bridge once if its executable is missing
npm run local:start:all -- --build-bridge

# Use the production build after running the normal local build
npm run local:build -- --instance 1
npm run local:start:all -- --mode production
```

The launcher reuses healthy services and refuses to start a second Bridge if port 47615 is occupied by an unhealthy process. It stores launcher logs in `.spectra-local/instances/1/logs/`. Stop the complete local stack with `npm run local:stop -- --instance 1`; stopping the stack does not delete its Convex database or Bridge journal.
