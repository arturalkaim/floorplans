import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Gallery } from "./routes/gallery";
import { Playground } from "./routes/playground";
import { Reference } from "./routes/reference";

const rootRoute = createRootRoute({
  component: () => (
    <div className="wrap">
      <header className="masthead">
        <h1>
          <Link to="/">floorplan</Link>
        </h1>
        <p>A JSON description of rooms and openings becomes a scaled drawing, and a linter tells you what is wrong with the house.</p>
        <nav className="nav">
          <Link to="/" activeOptions={{ exact: true }}>
            {({ isActive }) => <span data-active={isActive}>Plans</span>}
          </Link>
          <Link to="/reference">{({ isActive }) => <span data-active={isActive}>Reference</span>}</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Gallery });
const planRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plan/$id", component: Playground });
const referenceRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reference", component: Reference });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, planRoute, referenceRoute]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
