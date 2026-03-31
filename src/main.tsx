import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css'; // <- this is important
import './search.ts';  // <-- this runs your search box and button logic


ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
