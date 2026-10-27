import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles/nocturne.css';
import './styles/app.css';
import App from './App';
import { hydrate } from './persistence';

void hydrate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
