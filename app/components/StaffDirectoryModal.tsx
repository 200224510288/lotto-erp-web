// app/components/StaffDirectoryModal.tsx
"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Trash2,
  X,
  Check,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  UserCheck,
  UserX,
  Edit2,
  Save,
} from "lucide-react";
import {
  StaffMemberMaster,
  getStaffDirectory,
  saveStaffMember,
  deleteStaffMember,
  toggleStaffActive,
  clearAllStaffDirectory,
} from "../lib/scanBalancingService";

interface StaffDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDirectoryChanged: () => void;
  onApplyActiveToToday?: (activeStaff: StaffMemberMaster[]) => void;
}

export default function StaffDirectoryModal({
  isOpen,
  onClose,
  onDirectoryChanged,
  onApplyActiveToToday,
}: StaffDirectoryModalProps) {
  const [directory, setDirectory] = useState<StaffMemberMaster[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New staff input
  const [newName, setNewName] = useState<string>("");
  const [newDesignation, setNewDesignation] = useState<string>("Balancing Officer");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Editing staff inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editDesignation, setEditDesignation] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      loadDirectory();
    }
  }, [isOpen]);

  async function loadDirectory() {
    setLoading(true);
    setError(null);
    try {
      const list = await getStaffDirectory();
      setDirectory(list);
    } catch {
      setError("Failed to load staff directory.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setError("Please enter staff name.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await saveStaffMember({
        name: newName.trim(),
        designation: newDesignation.trim() || "Balancing Officer",
        isActive: true,
      });
      setNewName("");
      setSuccess("Staff member added successfully!");
      setTimeout(() => setSuccess(null), 2500);
      await loadDirectory();
      onDirectoryChanged();
    } catch {
      setError("Failed to add staff member.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleStatus(staff: StaffMemberMaster) {
    try {
      await toggleStaffActive(staff.id, !staff.isActive);
      setDirectory((prev) =>
        prev.map((s) => (s.id === staff.id ? { ...s, isActive: !s.isActive } : s))
      );
      onDirectoryChanged();
    } catch {
      setError("Failed to update staff status.");
    }
  }

  async function handleDeleteStaff(id: string, name: string) {
    if (!window.confirm(`Are you sure you want to remove "${name}" from the Staff Directory?`)) {
      return;
    }

    try {
      await deleteStaffMember(id);
      setDirectory((prev) => prev.filter((s) => s.id !== id));
      onDirectoryChanged();
    } catch {
      setError("Failed to delete staff member.");
    }
  }

  function startEditing(staff: StaffMemberMaster) {
    setEditingId(staff.id);
    setEditName(staff.name);
    setEditDesignation(staff.designation || "Balancing Officer");
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      await saveStaffMember({
        id,
        name: editName.trim(),
        designation: editDesignation.trim(),
      });
      setEditingId(null);
      await loadDirectory();
      onDirectoryChanged();
    } catch {
      setError("Failed to update staff member.");
    }
  }

  async function handleClearAll() {
    if (!window.confirm("Are you sure you want to remove ALL staff members from the directory?")) {
      return;
    }
    try {
      await clearAllStaffDirectory();
      setDirectory([]);
      onDirectoryChanged();
      setSuccess("All staff members removed.");
      setTimeout(() => setSuccess(null), 2500);
    } catch {
      setError("Failed to clear staff directory.");
    }
  }

  if (!isOpen) return null;

  const activeCount = directory.filter((s) => s.isActive).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-300 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Master Staff Directory</h2>
              <p className="text-xs text-slate-400">
                Manage registered officers and their availability for daily scan balancing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="px-6 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError(null)} className="text-red-500 font-bold">
              ✕
            </button>
          </div>
        )}
        {success && (
          <div className="px-6 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Add New Staff Form */}
        <div className="p-5 border-b border-slate-200 bg-slate-50/80">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Add New Staff Member</span>
          </h3>

          <form onSubmit={handleAddStaff} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-6">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Staff Full Name"
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-4">
              <input
                type="text"
                value={newDesignation}
                onChange={(e) => setNewDesignation(e.target.value)}
                placeholder="Designation (optional)"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={isSubmitting || !newName.trim()}
                className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </form>
        </div>

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>
              Registered Staff ({directory.length} total, <b className="text-emerald-700">{activeCount} active</b>)
            </span>
            <div className="flex items-center gap-3">
              <span>Click toggle to set active / on leave</span>
              {directory.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-red-600 hover:text-red-800 text-[11px] font-semibold underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              <span className="inline-block animate-spin mr-2">⏳</span>
              <span>Loading staff directory…</span>
            </div>
          ) : directory.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 space-y-1">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-700">No staff members registered</p>
              <p className="text-[11px] text-slate-400">
                Use the form above to add your real staff members.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              {directory.map((staff, idx) => {
                const isEditing = editingId === staff.id;

                return (
                  <div
                    key={staff.id}
                    className={`px-4 py-3 flex items-center justify-between gap-3 transition ${
                      staff.isActive ? "hover:bg-slate-50" : "bg-slate-50/50 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-xs font-bold font-mono">
                        {idx + 1}
                      </span>

                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-2 py-1 text-xs font-bold border border-blue-400 rounded bg-white w-40"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editDesignation}
                            onChange={(e) => setEditDesignation(e.target.value)}
                            placeholder="Designation"
                            className="px-2 py-1 text-xs border border-slate-300 rounded bg-white w-32"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(staff.id)}
                            className="p-1 text-emerald-600 hover:text-emerald-800"
                            title="Save"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1 text-slate-400 hover:text-slate-600"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 truncate">
                              {staff.name}
                            </span>
                            {staff.isActive ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                <UserCheck className="w-3 h-3" />
                                <span>Active</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 flex items-center gap-1">
                                <UserX className="w-3 h-3" />
                                <span>On Leave</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 block truncate">
                            {staff.designation || "Balancing Officer"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Toggle Active */}
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(staff)}
                        className={`p-1 rounded-md transition ${
                          staff.isActive
                            ? "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                            : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        }`}
                        title={staff.isActive ? "Mark On Leave" : "Mark Active"}
                      >
                        {staff.isActive ? (
                          <ToggleRight className="w-6 h-6" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>

                      {/* Edit */}
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEditing(staff)}
                          className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                          title="Edit staff details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDeleteStaff(staff.id, staff.name)}
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                        title="Delete from directory"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {onApplyActiveToToday && (
              <button
                type="button"
                onClick={() => {
                  onApplyActiveToToday(directory.filter((s) => s.isActive));
                  onClose();
                }}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center gap-1.5"
              >
                <UserCheck className="w-4 h-4" />
                <span>Load Active Staff to Today's Allocation ({activeCount})</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
