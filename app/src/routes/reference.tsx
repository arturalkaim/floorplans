import { ARC_SYNTAX, DSL_SCHEMA, FIXTURE_TYPES, OPENING_TYPES, RULES, ROOM_KINDS, SCHEMA, SIDES, VERTICAL_TYPES } from "floorplan";
import type { FieldDoc, RuleDoc } from "floorplan";

/**
 * One field's doc string, looked up by object + name from the library's own SCHEMA table
 * (src/parse.ts) rather than typed out here — the field tables below cannot drift from
 * what the parser actually accepts, which is the drift `docs/agent-review.md` B10 flagged
 * in the hand-written tables this replaced. Throws if a field is renamed or removed, so a
 * stale reference fails loudly instead of quietly describing a field that no longer exists.
 */
function field(object: string, name: string): FieldDoc {
  const obj = SCHEMA.find((o) => o.object === object);
  const f = obj?.fields.find((f) => f.name === name);
  if (!f) throw new Error(`reference.tsx: SCHEMA has no ${object}.${name}`);
  return f;
}

/**
 * The DSL reference. Every list on this page is read from the library at runtime — the
 * room kinds and fixture types come from the parser's own sets, the field tables and the
 * rule table from tables the library ships. Nothing here is a copy that can fall out of
 * date.
 */
export function Reference() {
  const bySeverity = (s: RuleDoc["severity"]) => RULES.filter((r) => r.severity === s);
  return (
    <article className="doc">
      <p>
        A plan is one document, written either as JSON or in the <a href="#dsl">line DSL</a>. Coordinates are{" "}
        <strong>metres on wall centrelines</strong>, y grows downwards, and rooms must tile the footprint
        exactly — walls are derived from the edges they share, never authored. A room is any simple polygon —
        straight edges at any angle, or true circular arcs — and a plan has one storey or many.
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
  "voids":    { "<id>": { "name", "poly" | "rect" } },
  "fixtures": [ { "id"?, "type", "in", "poly" | "at" + "size" } ],
  "openings": [ { "id"?, "type", "between", "on", "position", "width" } ]
}`}</code></pre>

      <h2>Rooms</h2>
      <p>
        Give a room a <code>poly</code> or a <code>rect</code>, or place it in a <code>layout</code> grid and
        omit the geometry. The polygon may have any winding and three corners or more, and its edges may run
        at any angle — L, T and U shapes, a wing at 45°, a canted bay. What is refused, with the reason:
        fewer than three distinct corners, zero area, and a boundary that crosses or touches itself.
      </p>
      <p>
        Any entry of a <code>poly</code> may be an <strong>arc</strong> instead of a corner:{" "}
        <code>{'{ "arc": [x, y], "r": 3.5, "sweep": "cw" | "ccw", "large": true }'}</code> — an arc from the
        previous corner to that point, of that radius, turning that way seen on the page. The centre is
        derived and never stored, so the radius can be edited on its own. An arc is exact where it matters: a
        round room measures πr², its clear floor is the same arc with a smaller radius, and it is drawn as an
        SVG <code>A</code> command. Two rooms share a curved wall by writing the same arc, each in its own
        direction; the flattening used for the topology takes nothing but the arc, so their chords always
        agree and no sliver is left between them.
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
        token in several cells makes one room, and <code>.</code> is a void. The grid stays rectilinear on
        purpose: it is what an apartment wants, and anything else is a <code>poly</code>.
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

      <h2>Levels</h2>
      <p>
        A document with no <code>levels</code> block is a single-level plan and stays exactly what it was:
        same findings, same drawing, same document paths. Everything here is additive.
      </p>
      <pre><code>{`{
  "stack": ["piso0", "piso1"],                 // ground-up; optional, key order otherwise
  "grid": { "cols": [4.9, 1.2, 1.3, 4.4], "rows": [1.4, 1.8, 2, 2, 1, 1.8] },
  "levels": {
    "piso0": { "name", "height", "ground": true, "rooms", "outdoor", "voids", "openings", "fixtures" },
    "piso1": { "name", "height", "layout": { "areas": [ … ] }, "rooms", "voids", "openings" }
  },
  "vertical": [
    { "id": "escada", "type": "stairs", "up": 0, "risers": 15,
      "at": [{ "level": "piso0", "in": "hall",     "rect": [4.95, 0.2, 1.1, 3.64] },
             { "level": "piso1", "in": "hall_sup", "rect": [4.95, 0.2, 1.1, 1.1] }] }
  ]
}`}</code></pre>
      <table>
        <tbody>
          {[field("plan", "stack"), field("plan", "levels"), field("level", "ground"), field("level", "height"), field("plan", "grid")].map((f) => (
            <tr key={f.name}><td><code>{f.name}</code></td><td>{f.doc}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        Levels share the plan origin and axes — no per-level transform — so every sheet lines up with every
        other. <code>renderSvg(model, {"{ level }"})</code> draws one storey and ghosts the one below it;{" "}
        <code>floorplan()</code> returns a drawing per level and keeps <code>svg</code> as the ground level's.
      </p>

      <h3>Vertical circulation</h3>
      <p>
        Stairs, lifts and ramps are the only entity that spans levels, and they are matched between levels by
        their own <code>id</code> — never by footprint overlap, which would silently join two shafts that
        happen to touch and would make <code>stair.misaligned</code> impossible to express. Each{" "}
        <code>at</code> entry gives a footprint and the space you step off it into on that level.{" "}
        <code>up</code> (a bearing) and <code>risers</code> are optional, and each one unlocks one check.
      </p>
      <ul className="tokens">{[...VERTICAL_TYPES].map((k) => <li key={k}><code>{k}</code></li>)}</ul>
      <p>
        On every level it serves it is an obstacle exactly as a <code>stairs</code> fixture is. It has no{" "}
        <code>fixtures[i]</code> to address, so a finding about one carries <code>vertical</code> rather than{" "}
        <code>fixture</code>. The <code>stairs</code> fixture type is unchanged: on a single-level plan it is
        still the way to draw a stair that goes somewhere the model does not describe.
      </p>

      <h3>Voids</h3>
      <p>
        A <code>void</code> is the dual of an outdoor space: an outdoor space is a declared absence of{" "}
        <em>roof</em>, a void is a declared absence of <em>floor</em> — a stairwell, a double-height room, the
        underside of a cantilever. Like an outdoor space it stops the cell being a <code>tiling.gap</code> and
        it owns the wall beside it, but it has the building over it, so that wall is an ordinary partition and
        a window onto it is still <code>window.not_exterior</code>. Its area stays out of the interior and
        inside the envelope, and nothing opens into one. A void must reach an edge of the room around it: a
        room enclosing one completely would be a ring, which a single ring cannot express.
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
          {SCHEMA.find((o) => o.object === "opening")!.fields.filter((f) => f.name !== "type").map((f) => (
            <tr key={f.name}><td><code>{f.name}</code></td><td>{f.doc}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>side</h3>
      <ul className="tokens">{[...SIDES].map((k) => <li key={k}><code>{k}</code></li>)}</ul>
      <p>
        <code>side</code> names a compass side, which says nothing about a wall at 20°. On a wall that is not
        axis-aligned, use <code>{'"at": [x, y]'}</code> instead: it names a point, and the library finds the
        nearest wall between the two spaces and projects onto it — along the arc, if the wall is curved.
        Asking for a <code>side</code> on such a wall is <code>wall.ambiguous</code>, with a message that says
        so.
      </p>

      <h2 id="dsl">The line DSL</h2>
      <p>
        The same document, written one entity per line. It is an <em>authoring</em> syntax: it compiles to the
        JSON above and nothing downstream — the geometry, the rules, the drawing — sees the difference. Every
        entry point sniffs the first non-space character, so <code>{"{"}</code> is JSON and anything else is
        the DSL; <code>floorplan fmt &lt;file&gt; --to json|dsl</code> converts between them, and the{" "}
        <strong>JSON | DSL</strong> toggle above the playground editor does the same thing in the browser.
      </p>
      <p>
        It exists for the cost. Measured with <code>o200k_base</code>: casa-t3 is <strong>1 502</strong>{" "}
        tokens as canonical JSON and <strong>788</strong> here; one door is 61 tokens against 14. Openings are
        55 % of a plan's tokens, and an opening is exactly where the key names repeat.
      </p>
      <pre><code>{`plan "Cabana" walls 0.2/0.1

room sala "Sala e cozinha" living rect 0,0 5x4
room wc "Casa de banho" wc rect 5,0 1.2x2
outdoor deck "Deck" rect 0,4 5x2

door deck>sala at:0.9,4 w0.9 hinge:start swing:sala
door sala>wc @-0.5 w0.7 hinge:end swing:wc
window sala.north @2.5 w2.4
window wc.east w0.6`}</code></pre>
      <h3>Statements</h3>
      <dl className="grammar">
        {DSL_SCHEMA.map((st) => (
          <div key={st.statement}>
            <dt><pre><code>{st.syntax}</code></pre></dt>
            <dd>{st.doc}</dd>
          </div>
        ))}
      </dl>
      <p>
        A <code>poly</code> takes <code>&lt;x&gt;,&lt;y&gt;</code> corners and, for a curve,{" "}
        <code>{ARC_SYNTAX}</code> — an arc from the previous corner to this one. <code>@&lt;d&gt;</code> is
        metres from the wall run’s start to the opening’s centre and <code>@-&lt;d&gt;</code> from its end;{" "}
        <code>&lt;room&gt;.&lt;side&gt;</code> on its own is the short form of{" "}
        <code>exterior&gt;&lt;room&gt;</code> with an <code>on</code>. A boolean is its own name for true and{" "}
        <code>name:false</code> for false. Comments start with <code>#</code>.
      </p>
      <h3>Every field, and the token that writes it</h3>
      <p>
        Generated from the same table <code>floorplan --schema=dsl</code> prints. A test walks the JSON schema
        and fails if a field has no token here, so the two syntaxes can express exactly the same documents.
      </p>
      <table>
        <tbody>
          {SCHEMA.flatMap((o) =>
            o.fields.map((f) => {
              const key = `${o.object}.${f.name}`;
              const tokens = [...new Set(DSL_SCHEMA.flatMap((st) => st.tokens.filter((t) => t.field === key).map((t) => t.token)))];
              return (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td>{tokens.map((t) => <code key={t} style={{ marginRight: 8 }}>{t}</code>)}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      <p>
        A finding on a DSL document carries <code>line</code> beside its <code>path</code> — beside, never
        instead: the JSON path is the contract, and the line is the address the DSL adds.{" "}
        <code>set</code> and a drag both splice one token on one line and leave the rest of the file alone.
      </p>

      <h2>Findings</h2>
      <p>
        Every finding is{" "}
        <code>{"{ rule, severity, message, path, level?, at?, rooms?, opening?, fixture?, vertical? }"}</code>.{" "}
        <code>path</code> is the JSON path of the thing the rule is about — <code>openings[3].width</code>,{" "}
        <code>rooms.sala.rect</code>, <code>levels.piso1.fixtures[2]</code> — derived from the document that
        was parsed rather than from a template, so it names a node that is really there and{" "}
        <code>set</code> takes it verbatim. A field is only appended when the author wrote it: an opening that
        let <code>position</code> default has no <code>position</code> to splice.
      </p>
      <p>
        <code>opening</code> and <code>fixture</code> are stable ids, never array indices — an authored{" "}
        <code>id</code>, or one synthesised as <code>&lt;type&gt;:&lt;a&gt;-&lt;b&gt;:&lt;n&gt;</code> for an
        opening and <code>&lt;type&gt;:&lt;in&gt;:&lt;n&gt;</code> for a fixture, so deleting{" "}
        <code>openings[2]</code> renumbers only its own pair's later siblings.{" "}
        <code>level</code> names the storey it is about, and is absent both on a building-wide finding and on
        every finding of a document with no <code>levels</code> block.
      </p>
      <p>
        <code>parse()</code> and <code>floorplan()</code> throw on a schema problem; <code>lint()</code> never
        throws and returns it as a <code>schema.*</code> finding carrying the same document path, so one loop
        handles every problem a document can have. Geometry and semantic problems are always findings, so a
        broken plan still draws. The CLI exits <code>0</code> when clean or info only, <code>1</code> at
        warning or above, <code>2</code> on a schema error.
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
