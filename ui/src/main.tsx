import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider, alpha, createTheme } from '@mui/material'
import App from './App'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7dd3a7' },
    secondary: { main: '#9f7aea' },
    background: { default: '#070b14', paper: '#101728' },
    text: {
      primary: '#eef2ff',
      secondary: 'rgba(238,242,255,0.72)',
    },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    h3: { letterSpacing: '-0.03em' },
    h5: { letterSpacing: '-0.02em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': { colorScheme: 'dark' },
        body: {
          backgroundColor: '#070b14',
          backgroundImage: 'radial-gradient(circle at top, rgba(99,102,241,0.16), transparent 28%)',
        },
        '::selection': {
          backgroundColor: 'rgba(125,211,167,0.28)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 14,
          textTransform: 'none',
          fontWeight: 700,
        },
        contained: {
          background: 'linear-gradient(135deg, #7dd3a7, #67c8a1)',
          color: '#08110e',
          '&:hover': {
            background: 'linear-gradient(135deg, #92e4ba, #74d5ad)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: alpha('#ffffff', 0.03),
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7dd3a7',
            boxShadow: '0 0 0 3px rgba(125,211,167,0.14)',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          '&.Mui-selected': {
            backgroundColor: alpha('#7dd3a7', 0.12),
            border: '1px solid rgba(125,211,167,0.2)',
          },
        },
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
