import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip, Fade } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

interface JsonViewerProps {
  data: any;
  title?: string;
  maxHeight?: string | number;
  defaultExpanded?: boolean;
}

const JsonNode: React.FC<{ 
  data: any; 
  level: number; 
  isLast: boolean;
  path: string;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
}> = ({ data, level, isLast, path, expandedPaths, togglePath }) => {
  const isExpanded = expandedPaths.has(path);
  const indent = level * 16;
  const isExpandable = (item: any) => (typeof item === 'object' && item !== null && Object.keys(item).length > 0);
  if (Array.isArray(data)) {
    if (data.length === 0) return <div style={{ paddingLeft: indent, color: '#e6e6e6' }}>[]{!isLast && <span style={{ color: '#e6e6e6' }}>,</span>}</div>;
    return <><div style={{ paddingLeft: indent }}>{isExpandable(data) ? <IconButton size="small" onClick={() => togglePath(path)} sx={{ p: 0, mr: 0.5, color: 'rgba(255, 255, 255, 0.7)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><KeyboardArrowRightIcon fontSize="small" /></IconButton> : null}<span style={{ color: '#64B5F6' }}>[</span>{!isExpanded && <span style={{ color: '#9E9E9E' }}>...</span>}</div>{isExpanded && data.map((item, index) => <JsonNode key={`${path}-${index}`} data={item} level={level + 1} isLast={index === data.length - 1} path={`${path}-${index}`} expandedPaths={expandedPaths} togglePath={togglePath} />)}<div style={{ paddingLeft: indent }}><span style={{ color: '#64B5F6' }}>]</span>{!isLast && <span style={{ color: '#e6e6e6' }}>,</span>}</div></>;
  }
  if (typeof data === 'object' && data !== null) {
    const keys = Object.keys(data);
    if (keys.length === 0) return <div style={{ paddingLeft: indent, color: '#e6e6e6' }}>{'{}'}{!isLast && <span style={{ color: '#e6e6e6' }}>,</span>}</div>;
    return <><div style={{ paddingLeft: indent }}>{isExpandable(data) ? <IconButton size="small" onClick={() => togglePath(path)} sx={{ p: 0, mr: 0.5, color: 'rgba(255, 255, 255, 0.7)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><KeyboardArrowRightIcon fontSize="small" /></IconButton> : null}<span style={{ color: '#90CAF9' }}>{`{`}</span>{!isExpanded && <span style={{ color: '#9E9E9E' }}>...</span>}</div>{isExpanded && keys.map((key, index) => <div key={`${path}-${key}`} style={{ paddingLeft: indent + 16 }}><span style={{ color: '#F06292' }}>{`"${key}"`}</span><span style={{ color: '#e6e6e6' }}>: </span>{isExpandable((data as any)[key]) ? <JsonNode data={(data as any)[key]} level={0} isLast={index === keys.length - 1} path={`${path}-${key}`} expandedPaths={expandedPaths} togglePath={togglePath} /> : <JsonValue value={(data as any)[key]} isLast={index === keys.length - 1} />}</div>)}<div style={{ paddingLeft: indent }}><span style={{ color: '#90CAF9' }}>{`}`}</span>{!isLast && <span style={{ color: '#e6e6e6' }}>,</span>}</div></>;
  }
  return <JsonValue value={data} isLast={isLast} paddingLeft={indent} />;
};

const JsonValue: React.FC<{ value: any; isLast: boolean; paddingLeft?: number }> = ({ value, isLast, paddingLeft }) => {
  let color = '#e6e6e6';
  let displayValue: React.ReactNode = String(value);
  if (typeof value === 'string') { color = '#FFCC80'; displayValue = `"${value}"`; }
  else if (typeof value === 'number') color = '#81C784';
  else if (typeof value === 'boolean') color = '#BA68C8';
  else if (value === null) { color = '#EF5350'; displayValue = 'null'; }
  return <div style={{ display: 'inline', paddingLeft: paddingLeft || 0 }}><span style={{ color }}>{displayValue}</span>{!isLast && <span style={{ color: '#e6e6e6' }}>,</span>}</div>;
};

const JsonViewer: React.FC<JsonViewerProps> = ({ data, title, maxHeight = '500px', defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']));
  const handleCopy = () => { navigator.clipboard.writeText(JSON.stringify(data, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const togglePath = (path: string) => { const next = new Set(expandedPaths); next.has(path) ? next.delete(path) : next.add(path); setExpandedPaths(next); };
  const toggleAllPaths = (expand: boolean) => {
    if (!expand) return setExpandedPaths(new Set(['root']));
    const allPaths = new Set<string>(['root']);
    const collect = (obj: any, currentPath = 'root') => { if (typeof obj !== 'object' || obj === null) return; allPaths.add(currentPath); if (Array.isArray(obj)) obj.forEach((item, index) => collect(item, `${currentPath}-${index}`)); else Object.entries(obj).forEach(([key, value]) => collect(value, `${currentPath}-${key}`)); };
    collect(data); setExpandedPaths(allPaths);
  };
  useEffect(() => { toggleAllPaths(true); }, [data]);
  return <Paper elevation={0} sx={{ borderRadius: 2.5, overflow: 'hidden', mb: 2.5, backgroundColor: '#1E1E1E', border: '1px solid rgba(255, 255, 255, 0.05)', ...(isFullScreen && { position: 'fixed', inset: 0, zIndex: 9999, margin: 0, borderRadius: 0, maxHeight: '100vh', display: 'flex', flexDirection: 'column' }) }}><Box sx={{ p: 1.5, pl: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: expanded ? '1px solid rgba(255, 255, 255, 0.05)' : 'none', backgroundColor: '#1E1E1E' }}><Typography variant="subtitle1" fontWeight="600">{title || 'JSON Data'}</Typography><Box><Tooltip title="Expand All"><IconButton size="small" onClick={() => toggleAllPaths(true)}><KeyboardArrowDownIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="Collapse All"><IconButton size="small" onClick={() => toggleAllPaths(false)}><KeyboardArrowUpIcon fontSize="small" /></IconButton></Tooltip><Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}><IconButton size="small" onClick={handleCopy}>{copied ? <CheckCircleIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}</IconButton></Tooltip><Tooltip title={isFullScreen ? 'Exit full screen' : 'Full screen'}><IconButton size="small" onClick={() => setIsFullScreen(!isFullScreen)}>{isFullScreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}</IconButton></Tooltip><Tooltip title={expanded ? 'Collapse' : 'Expand'}><IconButton size="small" onClick={() => setExpanded(!expanded)}>{expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}</IconButton></Tooltip></Box></Box>{expanded && <Box sx={{ p: 2, maxHeight: isFullScreen ? 'calc(100vh - 60px)' : maxHeight, overflow: 'auto', backgroundColor: '#1E1E1E', fontFamily: '"SF Mono", monospace', fontSize: '0.875rem', lineHeight: 1.5, color: 'rgba(255, 255, 255, 0.9)', flexGrow: isFullScreen ? 1 : 0 }}><JsonNode data={data} level={0} isLast={true} path="root" expandedPaths={expandedPaths} togglePath={togglePath} /></Box>}</Paper>;
};

export default JsonViewer;
