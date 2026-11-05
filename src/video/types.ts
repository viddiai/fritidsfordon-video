// Delade typer mellan mallen (Remotion) och backend.

export type Vehicle = {
  id: string;            // pageId / produkt-id
  uniqueId?: string;
  artikelnr?: string;
  url?: string;
  typ: string;           // "Husbil" | "Husvagn"
  marke: string;
  modell: string;
  modellar: number;
  skick: string;         // "Ny" | "Begagnad"
  pris: number;          // aktuellt pris (kampanjpris om sådant finns)
  ordPris: number | null; // ordinarie pris när kampanjpris finns
  manad: number | null;  // delbetalning/mån
  anlaggning: string;
  telefon: string;
  specs: Record<string, string>;
  saljpunkter: string[];
  bilder: string[];      // bild-id:n i sajtens ordning
  punktBilder?: string[];
};

export type SceneKind = 'intro' | 'point' | 'specs' | 'outro';

export type Scene = {
  kind: SceneKind;
  frames: number;
  /** Bild-id för scenen (intro/point/outro) */
  image?: string;
  /** Text på skärmen (point) */
  text?: string;
  /** Ljudfil relativt assetBase (eller public/) */
  audio?: string;
};

export type Format = 'vertical' | 'landscape';

export type VideoProps = {
  vehicle: Vehicle;
  format: Format;
  scenes: Scene[];
  sold: boolean;
  /** Bas-URL där bilder/ljud ligger (http://127.0.0.1:port). Tom = staticFile() i public/. */
  assetBase: string;
};
