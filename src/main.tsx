import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/icons/regular.css'; // the icons the app uses, cut from @phosphor-icons/web (npm run icons:subset)
import './styles/icons/fill.css';
import './styles/nocturne.css';
import './styles/app.css';
import App from './App';
import { hydrate } from './persistence';
import { reportUncaughtErrors } from './error-reporting';

reportUncaughtErrors();
void hydrate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
