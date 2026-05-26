import React from 'react';

const ToolSelector = ({ onModuleSelect }) => {
  const modules = [
    { id: 'ip', label: 'Intellectual Property', icon: '⚖️' },
    { id: 'dispute', label: 'Dispute Resolution', icon: '🤝' },
    { id: 'dd', label: 'Due Diligence', icon: '🔍' },
    { id: 'industry', label: 'Industry Regulations', icon: '🏢' },
    { id: 'policy', label: 'Policy Updates', icon: '📢' },
    { id: 'contract', label: 'Contract Review', icon: '📄' },
  ];

  return (
    <div className="tool-selector bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 px-1">
        Legal Focus Area
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {modules.map((mod) => (
          <button
            key={mod.id}
            className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 group"
            onClick={() => onModuleSelect(mod.id)}
            aria-label={`Switch to ${mod.label}`}
          >
            <span className="text-xl group-hover:scale-110 transition-transform">
              {mod.icon}
            </span>
            <span className="text-xs font-medium text-gray-800 group-hover:text-blue-700 text-center">
              {mod.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ToolSelector;