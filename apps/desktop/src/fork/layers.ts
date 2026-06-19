import * as Layer from "effect/Layer";

import * as ElectronNotification from "../electron/ElectronNotification.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";

export const forkElectronLayer = ElectronNotification.layer.pipe(
  Layer.provideMerge(ElectronWindow.layer),
);
