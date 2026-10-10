import { ModelPicker } from '../../models/index.js';
import { useContext } from 'react';
import { MainPageContext } from '../../../app/windows/MainPageContext.jsx';

export function ChatModelPicker(props) {
  const view = useContext(MainPageContext);
  return <ModelPicker {...props} onSaveModelConfig={view?.models ? config => view.models.save(config) : undefined} />;
}
