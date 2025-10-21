import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const rawBaseUrl = import.meta.env.BASE_URL ?? '/';
const normalizedBase = rawBaseUrl.endsWith('/') && rawBaseUrl !== '/' ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
const routerBasename = normalizedBase === '/' ? undefined : normalizedBase;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
