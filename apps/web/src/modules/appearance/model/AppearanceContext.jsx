import { createContext, useContext } from "react";

const AppearanceContext = createContext(null);

export function AppearanceProvider({ model, children }) {
  return <AppearanceContext.Provider value={model || null}>{children}</AppearanceContext.Provider>;
}

export function useDshAppearance() {
  return useContext(AppearanceContext);
}
