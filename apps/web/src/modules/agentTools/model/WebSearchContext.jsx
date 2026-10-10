import { createContext, useContext } from 'react';

const WebSearchContext = createContext(null);

export function WebSearchProvider({ model, children }) {
  return <WebSearchContext.Provider value={model || null}>{children}</WebSearchContext.Provider>;
}

export function useWebSearchModel() {
  const model = useContext(WebSearchContext);
  if (!model) throw new Error('联网搜索设置服务尚未接入 DSH Client。');
  return model;
}
