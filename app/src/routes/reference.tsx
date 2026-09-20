import { FIXTURE_TYPES, OPENING_TYPES, RULES, ROOM_KINDS, SIDES } from "floorplan";
import type { RuleDoc } from "floorplan";

/**
 * The DSL reference. Every list on this page is read from the library at runtime — the
 * room kinds and fixture types come from the parser's own sets, the rule table from the
 * catalogue the library ships. Nothing here is a copy that can fall out of date.
 */
export function Reference() {
  const bySeverity = (s: RuleDoc["severity"]) => RULES.filter((r) => r.severity === s);
  return (
    <article className="doc">
      <p>
        A plan is one JSON document. Coordinates are <strong>metres on wall centrelines</strong>, y grows
        downwards, and rooms must tile the footprint exactly — walls are derived from the edges they share,
        never authored. Plans are rectilinear and single level.
      </p>
      <p>
        Write it in canonical form: <strong>one entity per line</strong> — a room, an outdoor space, an
        opening, a fixture is exactly one line, never wrapped — with compact separators inside the entity and
        one member per line in anything that holds a collection of entities. It is what{" "}
        <code>formatText</code> produces and what every example here is stored as, and it is 26 % cheaper to
        read and write than the prettified form — 31 % with <code>rect</code>.
      </p>

      <h2>The shape of a document</h2>
      <pre><code>{`{
  "title": "Casa T3",
  "walls": { "exterior": 0.30, "partition": 0.12 },
  "rooms":    { "<id>": { "name", "kind", "zone", "poly" | "rect" } },
  "outdoor":  { "<id>": { "name", "poly" | "rect", "covered" } },
  "fixtures": [ { "type", "in", "poly" | "at" + "size" } ],
  "openings": [ { "type", "between", "on", "position", "width" } ]
}`}</code></pre>

      <h2>Rooms</h2>
      <p>
        Give a room a <code>poly</code> or a <code>rect</code>, or place it in a <code>layout</code> grid and
        omit the geometry. The polygon is rectilinear, any winding, and may have any number of corners — L, T
        and U shapes are all legal, so long as every edge is axis aligned.
      </p>
      <p>
        <code>{'"rect": [x, y, width, height]'}</code> is the same rectangle written as one row instead of
        four points — the mirror of a fixture's <code>at</code> + <code>size</code>. It is an alternative to{" "}
        <code>poly</code>, never both, and the parser expands it to the four corners, so nothing downstream
        knows the difference. A drag writes back in whichever form the source uses.
      </p>
      <h3>kind</h3>
      <ul className="tokens">{[...ROOM_KINDS].map((k) => <li key={k}><code>{k}</code></li>)}</ul>
      <p>
        <code>kind</code> decides <code>habitable</code>, <code>wet</code> and <code>circulation</code>, and
        each of those can be set explicitly to override it. <code>zone</code> is a free label used only to
        pick the fill colour.
      </p>

      <h2>Authoring on a grid</h2>
      <p>
        Most plans sit on a small track grid. Write it like CSS <code>grid-template-areas</code>: the same
        token in several cells makes one rectilinear room, and <code>.</code> is a void.
      </p>
      <pre><code>{`"layout": {
  "cols": [3.6, 4.0, 3.6],
  "rows": [3.4, 4.0, 3.4],
  "areas": [
    "sala sala  cozinha",
    "sala .     cozinha",
    "hall hall  hall"
  ]
}`}</code></pre>

      <h2>Outdoor spaces</h2>
      <p>
        Open sky, not floor: they stay out of the interior area and appear in their own schedule. Declare one
        <em> inside</em> the footprint and it becomes a courtyard — the walls around it derive as exterior
        walls, so a window onto a patio counts as daylight. Without the declaration the same void is a{" "}
        <code>tiling.gap</code>.
      </p>
      <p>
        An outdoor space is a space like any other: name its id in an opening's <code>between</code> to put a
        door or a window on the wall that faces it. The schedule says whether the street reaches it
        (<code>streetConnected</code>) — a deck on the boundary, yes; an enclosed courtyard, no. Only a door to
        the street is an entrance, so a house whose only door opens onto its patio reports{" "}
        <code>entrance.missing</code>.
      </p>

      <h2>Fixtures</h2>
      <p>
        Things that stand inside a space: they do not divide it, they take up floor. <code>in</code> names a
        room <em>or</em> an outdoor space, so a pool is a pool whether it sits in a spa or on a terrace. Give a{" "}
        <code>poly</code>, or <code>at</code> and <code>size</code> for a rectangle (rooms spell the same
        convenience <code>rect</code>). Rooms then report{" "}
        <code>usableArea</code> — the clear area less its fixtures.
      </p>
      <h3>type</h3>
      <ul className="tokens">{[...FIXTURE_TYPES].map((k) => <li key={k}><code>{k}</code></li>)}</ul>

      <h2>Openings</h2>
      <h3>type</h3>
      <ul className="tokens">{[...OPENING_TYPES].map((k) => <li key={k}><code>{k}</code></li>)}</ul>
      <table>
        <tbody>
          <tr><td><code>between</code></td><td>the two spaces it joins: room ids, an outdoor space id, or <code>"exterior"</code> for the street. At least one end must be a room</td></tr>
          <tr><td><code>on</code></td><td>which wall, when the pair shares several: <code>{"{ room, side, near }"}</code></td></tr>
          <tr><td><code>position</code></td><td><code>"center"</code>, metres from the wall's start, or <code>{'{ from, distance }'}</code></td></tr>
          <tr><td><code>at</code></td><td><code>[x, y]</code>: place by an absolute point instead of <code>on</code> + <code>position</code> — picks the nearest wall between the two spaces and projects the point onto it. Mutually exclusive with <code>on</code> and <code>position</code></td></tr>
          <tr><td><code>width</code></td><td>metres</td></tr>
          <tr><td><code>hinge</code></td><td>doors: which jamb. Walls run west→east and north→south</td></tr>
          <tr><td><code>swingInto</code></td><td>doors: the space the leaf opens into</td></tr>
          <tr><td><code>entrance</code></td><td>doors: marks the main entrance. It has to lead to the street, or you get <code>entrance.not_street</code></td></tr>
        </tbody>
      </table>
      <h3>side</h3>
      <ul className="tokens">{[...SIDES].map((k) => <li key={k}><code>{k}</code></li>)}</ul>

      <h2>Findings</h2>
      <p>
        Every finding is <code>{"{ rule, severity, message, at?, rooms?, opening?, fixture? }"}</code>. Schema
        problems throw; geometry and semantic problems come back as findings so a broken plan still draws. The
        CLI exits <code>0</code> when clean or info only, <code>1</code> at warning or above, <code>2</code> on
        a schema error.
      </p>
      {(["error", "warning", "info"] as const).map((sev) => (
        <section key={sev}>
          <h3>{sev}</h3>
          <table>
            <tbody>
              {bySeverity(sev).map((r) => (
                <tr key={r.id}>
                  <td><code>{r.id}</code></td>
                  <td>
                    {r.catches}
                    {r.option && <> — threshold: <code>{r.option}</code></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
        {RULES.length} rules. This page reads the library's own vocabularies and rule catalogue, so it cannot
        describe a rule the linter does not have.
      </p>
    </article>
  );
}
