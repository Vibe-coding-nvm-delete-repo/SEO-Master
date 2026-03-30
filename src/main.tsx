import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ToastProvider } from './ToastContext';
import ToastContainer from './ToastContainer';
import ContentPipelineQaHarness from './qa/ContentPipelineQaHarness';
import { installContentPipelineQaRuntime, isContentPipelineQaMode } from './qa/contentPipelineQaRuntime';
import './index.css';

const shouldRenderQaHarness = import.meta.env.DEV && isContentPipelineQaMode();

if (shouldRenderQaHarness) {
  installContentPipelineQaRuntime();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      {shouldRenderQaHarness ? <ContentPipelineQaHarness /> : <App />}
      <ToastContainer />
    </ToastProvider>
  </StrictMode>,
);
