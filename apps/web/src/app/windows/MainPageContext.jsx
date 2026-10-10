import { createContext, useContext } from "react";

export const MainPageContext = createContext(null);

export function useMainPageView() {
  const view = useContext(MainPageContext);
  if (!view) throw new Error("主页面必须在 ElecKoi 窗口中渲染。");
  return view;
}
