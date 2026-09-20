// The example plans are the repository's own fixtures, imported as text rather than
// copied, so the playground and the library's tests always show the same documents.
import apartmentT2 from "../../../fixtures/apartment-t2.json?raw";
import brokenGeometria from "../../../fixtures/broken-geometria.json?raw";
import broken from "../../../fixtures/broken.json?raw";
import brokenLevels from "../../../fixtures/broken-levels.json?raw";
import cabin from "../../../fixtures/cabin.json?raw";
import casaPatio from "../../../fixtures/casa-patio.json?raw";
import casaPiscina from "../../../fixtures/casa-piscina.json?raw";
import casaAngulo from "../../../fixtures/casa-angulo.json?raw";
import casaRedonda from "../../../fixtures/casa-redonda.json?raw";
import casaT3 from "../../../fixtures/casa-t3.json?raw";
import moradia2Pisos from "../../../fixtures/moradia-2-pisos.json?raw";
import quinta from "../../../fixtures/quinta.json?raw";

export interface Example {
  id: string;
  name: string;
  /** one line on what this plan is here to show */
  shows: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  { id: "casa-piscina", name: "Casa com Piscina", shows: "fixtures: an indoor pool, sanitary ware, a kitchen run", source: casaPiscina },
  { id: "casa-t3", name: "Casa T3", shows: "the seed house: thirteen rooms, eleven rects and two L-shapes", source: casaT3 },
  { id: "casa-patio", name: "Casa com Pátio", shows: "a courtyard — the Sala is lit only through it", source: casaPatio },
  { id: "quinta", name: "Quinta", shows: "an inner garden, a pool on a terrace, a detached shack", source: quinta },
  { id: "casa-angulo", name: "Casa com Ângulo", shows: "a wing at 45° and a canted bay: walls that are not axis-aligned", source: casaAngulo },
  { id: "casa-redonda", name: "Casa Redonda", shows: "two wings joined by a round hall, drawn with true circular arcs", source: casaRedonda },
  { id: "moradia-2-pisos", name: "Moradia de 2 pisos", shows: "two storeys: a shared track grid, a double-height void and a stair", source: moradia2Pisos },
  { id: "apartment-t2", name: "Apartamento T2", shows: "authored as a track grid instead of polygons", source: apartmentT2 },
  { id: "cabin", name: "Cabana", shows: "small enough that labels fall back to a numbered key", source: cabin },
  { id: "broken", name: "Broken on purpose", shows: "one of every error the linter can report", source: broken },
  { id: "broken-levels", name: "Broken on purpose: levels", shows: "one of every cross-level error the linter can report", source: brokenLevels },
  { id: "broken-geometria", name: "Broken on purpose: geometry", shows: "an overlap, a wedge nobody covers, and a corner too sharp to stand in", source: brokenGeometria },
];

export const byId = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id);
