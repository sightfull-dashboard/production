import { Fragment, StrictMode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const RootWrapper = (import.meta as any).env.DEV ? Fragment : StrictMode;

createRoot(document.getElementById('root')!).render(
  <RootWrapper>
    <App />
  </RootWrapper>,
);
