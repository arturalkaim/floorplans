import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

/**
 * What a route shows when it throws while rendering. It is the router's default, so it
 * renders inside the root's <Outlet />: the masthead and nav stay up, and the reader can
 * get back to the plans instead of staring at a blank page.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <section className="panel route-error" role="alert">
      <div className="panel-head">
        <h2>This page failed to render</h2>
      </div>
      <pre>{message}</pre>
      <div className="actions">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link to="/">Back to the plans</Link>
      </div>
    </section>
  );
}
