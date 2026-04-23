import React from 'react';
import { ThemeProvider } from './theme/ThemeProvider';
import { Toaster } from 'react-hot-toast'; // <-- 1. Import Toaster
import RefundAppLogic from './core/RefundAppLogic';
import './index.css';

function App() {
  return (
    <ThemeProvider>
      <RefundAppLogic />
      <Toaster position="bottom-right" /> {/* <-- 2. Add the component here */}
    </ThemeProvider>
  );
}

export default App;
