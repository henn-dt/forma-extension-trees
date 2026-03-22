import { useState, useEffect, useCallback } from 'react';
import { directusService, type FormaProject } from '../services/directus.service';
import './MyProjectsPanel.css';

// SVG Icons
const ProjectIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
  </svg>
);

const NameIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);

const LocationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const SizeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 3H3v18h18V3z"/>
    <path d="M9 3v18M3 9h18"/>
  </svg>
);

const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const LoadingSpinner = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spinner">
    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/>
  </svg>
);

interface MyProjectsPanelProps {
  onClose: () => void;
}

export function MyProjectsPanel({ onClose }: MyProjectsPanelProps) {
  const [projects, setProjects] = useState<FormaProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250);
  }, [onClose]);

  const loadProjects = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await directusService.getMyProjects();
      setProjects(result.projects);
    } catch (err: unknown) {
      console.error('Failed to load projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCoordinates = (coords?: string) => {
    if (!coords) return 'N/A';
    try {
      const parsed = JSON.parse(coords);
      if (Array.isArray(parsed) && parsed.length === 2) {
        const [lon, lat] = parsed;
        return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
      }
      return 'N/A';
    } catch {
      return 'N/A';
    }
  };

  return (
    <div
      className={`projects-overlay ${isClosing ? 'closing' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="projects-drawer">
        {/* Header */}
        <div className="drawer-header">
          <h2>
            <ProjectIcon />
            My Projects
          </h2>
          <button className="close-button" onClick={handleClose}>
            <CloseIcon />
          </button>
        </div>
        <p className="drawer-subtitle">Projects you have interacted with in Forma</p>

        {/* Content */}
        <div className="drawer-content">
          {isLoading ? (
            <div className="loading-state">
              <LoadingSpinner />
              <p>Loading your projects...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <p className="error-message">{error}</p>
              <button onClick={loadProjects} className="retry-button">
                Try Again
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <ProjectIcon />
              <h3>No Projects Yet</h3>
              <p>Projects will appear here after you click "Get Project Info" in Forma.</p>
            </div>
          ) : (
            <div className="projects-list">
              {projects.map((project) => (
                <div key={project.id} className="project-card">
                  <div className="project-card-header">
                    <h3 className="project-id">{project.porject_id}</h3>
                    <span className="project-date">
                      <CalendarIcon />
                      {formatDate(project.date_created)}
                    </span>
                  </div>

                  <div className="project-card-body">
                    <div className="project-info-row">
                      <NameIcon />
                      <div className="info-content">
                        <span className="info-label">Name</span>
                        <span className="info-value">{project.name || 'Unnamed Project'}</span>
                      </div>
                    </div>

                    <div className="project-info-row">
                      <LocationIcon />
                      <div className="info-content">
                        <span className="info-label">Location</span>
                        <span className="info-value">{formatCoordinates(project.coordinates)}</span>
                      </div>
                    </div>

                    <div className="project-info-row">
                      <SizeIcon />
                      <div className="info-content">
                        <span className="info-label">Size</span>
                        <span className="info-value">{project.size || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {project.date_updated && project.date_updated !== project.date_created && (
                    <div className="project-card-footer">
                      <span className="updated-text">
                        Updated: {formatDate(project.date_updated)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Refresh button */}
        {!isLoading && projects.length > 0 && (
          <div className="drawer-footer">
            <button onClick={loadProjects} className="refresh-button">
              Refresh Projects
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
