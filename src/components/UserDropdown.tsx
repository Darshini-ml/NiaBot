"use client";

import { useState, useEffect } from "react";
import {
  User,
  Settings,
  LogOut,
  ChevronDown,
  CreditCard,
  HelpCircle,
  Shield,
  Moon,
  Sun,
  X,
  Camera,
  Mail,
  Phone,
  MapPin,
  Save,
  Check,
  Bell,
  Globe,
  Palette,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Download,
  MessageCircle,
  FileText,
  ExternalLink,
} from "lucide-react";

interface UserInfo {
  name: string;
  email: string;
}

interface UserDropdownProps {
  onLogout?: () => void;
  user?: UserInfo;
  sidebarMode?: boolean;
}

type PanelType = "profile" | "subscription" | "settings" | "privacy" | "help" | null;

export default function UserDropdown({ onLogout, user, sidebarMode }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nia-theme");
      if (saved) return saved === "dark";
      return document.documentElement.getAttribute("data-theme") !== "light";
    }
    return true;
  });

  // Profile form state
  const [profileName, setProfileName] = useState(user?.name || "");
  const [profileEmail, setProfileEmail] = useState(user?.email || "");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  // Settings state
  const [notifications, setNotifications] = useState(true);
  const [soundEffects, setSoundEffects] = useState(true);
  const [compactMode, setCompactMode] = useState(false);

  // Privacy state
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [dataSharing, setDataSharing] = useState(false);
  const [deleteUsageConfirm, setDeleteUsageConfirm] = useState(false);
  const [deleteUsageLoading, setDeleteUsageLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileName(user.name || "");
      setProfileEmail(user.email || "");
    }
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("nia-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Load saved profile data
  useEffect(() => {
    if (!user?.email) return;
    try {
      const saved = localStorage.getItem(`nia_profile_${user.email}`);
      if (saved) {
        const data = JSON.parse(saved);
        setProfilePhone(data.phone || "");
        setProfileLocation(data.location || "");
        setProfileBio(data.bio || "");
      }
      const settingsData = localStorage.getItem(`nia_settings_${user.email}`);
      if (settingsData) {
        const s = JSON.parse(settingsData);
        setNotifications(s.notifications ?? true);
        setSoundEffects(s.soundEffects ?? true);
        setCompactMode(s.compactMode ?? false);
      }
      const privacyData = localStorage.getItem(`nia_privacy_${user.email}`);
      if (privacyData) {
        const p = JSON.parse(privacyData);
        setTwoFactor(p.twoFactor ?? false);
        setDataSharing(p.dataSharing ?? false);
      }
    } catch { /* ignore */ }
  }, [user?.email]);

  const handleSaveProfile = () => {
    if (user?.email) {
      localStorage.setItem(`nia_profile_${user.email}`, JSON.stringify({
        phone: profilePhone,
        location: profileLocation,
        bio: profileBio,
      }));
      // Update user name in main storage
      const storedUser = localStorage.getItem("nia_current_user");
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          userData.name = profileName;
          localStorage.setItem("nia_current_user", JSON.stringify(userData));
        } catch { /* ignore */ }
      }
    }
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  const handleSaveSettings = () => {
    if (user?.email) {
      localStorage.setItem(`nia_settings_${user.email}`, JSON.stringify({
        notifications, soundEffects, compactMode,
      }));
    }
  };

  const handleSavePrivacy = () => {
    if (user?.email) {
      localStorage.setItem(`nia_privacy_${user.email}`, JSON.stringify({
        twoFactor, dataSharing,
      }));
    }
  };

  const handleDeleteUsageHistory = async () => {
    setDeleteUsageLoading(true);
    try {
      // Clear server-side usage events
      await fetch("/api/usage", { method: "DELETE" });
      // Clear localStorage usage events
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith("nia_usage_events_")) {
          localStorage.removeItem(key);
        }
      }
      setDeleteUsageConfirm(false);
    } catch {
      // ignore
    } finally {
      setDeleteUsageLoading(false);
    }
  };

  const menuItems: { icon: typeof User; label: string; desc: string; badge?: string; panel: PanelType }[] = [
    { icon: User, label: "My Profile", desc: "View and edit profile", panel: "profile" },
    { icon: CreditCard, label: "Subscription", desc: "Premium Plan", badge: "PRO", panel: "subscription" },
    { icon: Settings, label: "Settings", desc: "Preferences & config", panel: "settings" },
    { icon: Shield, label: "Privacy & Security", desc: "Data & permissions", panel: "privacy" },
    { icon: HelpCircle, label: "Help & Support", desc: "FAQ & contact us", panel: "help" },
  ];

  const handleMenuClick = (panel: PanelType) => {
    setIsOpen(false);
    setActivePanel(panel);
  };

  const closePanel = () => setActivePanel(null);

  const ToggleSwitch = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-10 rounded-full transition-colors duration-300 ${value ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)]"}`}
      style={{ height: "22px" }}
    >
      <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${value ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );

  const renderPanel = () => {
    if (!activePanel) return null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closePanel} />

        {/* Modal */}
        <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl shadow-2xl shadow-black/50 animate-scale-in mx-4">
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--bg-elevated)] rounded-t-2xl z-10">
            <h2 className="text-[16px] font-bold text-[var(--text-primary)]">
              {activePanel === "profile" && "My Profile"}
              {activePanel === "subscription" && "Subscription"}
              {activePanel === "settings" && "Settings"}
              {activePanel === "privacy" && "Privacy & Security"}
              {activePanel === "help" && "Help & Support"}
            </h2>
            <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]">
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="p-5">
            {activePanel === "profile" && (
              <div className="space-y-5">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center text-white text-[28px] font-bold shadow-lg">
                      {profileName ? profileName.charAt(0).toUpperCase() : "U"}
                    </div>
                    <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center text-white shadow-md hover:scale-110 transition-transform">
                      <Camera size={13} />
                    </button>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-[var(--text-primary)]">{profileName || "User"}</p>
                    <p className="text-[12px] text-[var(--text-muted)]">{profileEmail}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full bg-gradient-to-r from-[#8b3dff] to-[#c13bd9] text-white tracking-wider">PRO</span>
                  </div>
                </div>

                {/* Form Fields */}
                <div className="space-y-3">
                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Full Name</label>
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Email</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Phone</label>
                    <div className="relative">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input
                        type="tel"
                        value={profilePhone}
                        onChange={(e) => setProfilePhone(e.target.value)}
                        placeholder="Enter phone number"
                        className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Location</label>
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input
                        type="text"
                        value={profileLocation}
                        onChange={(e) => setProfileLocation(e.target.value)}
                        placeholder="Enter your location"
                        className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Bio</label>
                    <textarea
                      value={profileBio}
                      onChange={(e) => setProfileBio(e.target.value)}
                      placeholder="Tell us about yourself..."
                      rows={3}
                      className="w-full px-3 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors resize-none"
                    />
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={handleSaveProfile}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-[#7C6EE6] to-[#9B8AFB] text-white text-[13px] font-semibold hover:shadow-lg hover:shadow-[#9B8AFB]/25 transition-all duration-300 active:scale-[0.98]"
                >
                  {profileSaved ? <><Check size={15} /> Saved!</> : <><Save size={15} /> Save Changes</>}
                </button>
              </div>
            )}

            {activePanel === "subscription" && (
              <div className="space-y-5">
                {/* Current Plan */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-[#8b3dff]/20 to-[#c13bd9]/20 border border-[#c13bd9]/30">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[14px] font-bold text-[var(--text-primary)]">Premium Plan</p>
                      <p className="text-[12px] text-[var(--text-muted)]">Full access to all features</p>
                    </div>
                    <span className="px-3 py-1 text-[11px] font-bold uppercase rounded-full bg-gradient-to-r from-[#8b3dff] to-[#c13bd9] text-white tracking-wider">ACTIVE</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[28px] font-bold text-[var(--text-primary)]">$19</span>
                    <span className="text-[13px] text-[var(--text-muted)]">/month</span>
                  </div>
                </div>

                {/* Features */}
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Included Features</p>
                  {["Unlimited conversations", "Advanced AI models", "Image generation", "Web search integration", "Priority support", "Custom instructions"].map((f) => (
                    <div key={f} className="flex items-center gap-2 py-1.5">
                      <Check size={14} className="text-emerald-400 shrink-0" />
                      <span className="text-[13px] text-[var(--text-primary)]">{f}</span>
                    </div>
                  ))}
                </div>

                {/* Billing */}
                <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)]">
                  <p className="text-[12px] font-medium text-[var(--text-muted)] mb-1">Next billing date</p>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">November 3, 2026</p>
                </div>

                <button className="w-full py-2.5 rounded-xl border border-[var(--border)] text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  Manage Billing
                </button>
              </div>
            )}

            {activePanel === "settings" && (
              <div className="space-y-4">
                {/* Appearance */}
                <div>
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Appearance</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Palette size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">Dark Mode</span>
                      </div>
                      <ToggleSwitch value={darkMode} onChange={setDarkMode} />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Settings size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">Compact Mode</span>
                      </div>
                      <ToggleSwitch value={compactMode} onChange={(v) => { setCompactMode(v); setTimeout(handleSaveSettings, 0); }} />
                    </div>
                  </div>
                </div>

                {/* Notifications */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Notifications</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Bell size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">Push Notifications</span>
                      </div>
                      <ToggleSwitch value={notifications} onChange={(v) => { setNotifications(v); setTimeout(handleSaveSettings, 0); }} />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Globe size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">Sound Effects</span>
                      </div>
                      <ToggleSwitch value={soundEffects} onChange={(v) => { setSoundEffects(v); setTimeout(handleSaveSettings, 0); }} />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveSettings}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-[#7C6EE6] to-[#9B8AFB] text-white text-[13px] font-semibold hover:shadow-lg hover:shadow-[#9B8AFB]/25 transition-all duration-300 active:scale-[0.98]"
                >
                  <Save size={15} /> Save Settings
                </button>
              </div>
            )}

            {activePanel === "privacy" && (
              <div className="space-y-4">
                {/* Security */}
                <div>
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Security</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[12px] font-medium text-[var(--text-muted)] mb-1 block">Change Password</label>
                      <div className="relative">
                        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="New password"
                          className="w-full pl-9 pr-10 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
                        />
                        <button
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Shield size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <div>
                          <span className="text-[13px] font-medium text-[var(--text-primary)] block">Two-Factor Auth</span>
                          <span className="text-[11px] text-[var(--text-muted)]">Extra layer of security</span>
                        </div>
                      </div>
                      <ToggleSwitch value={twoFactor} onChange={(v) => { setTwoFactor(v); setTimeout(handleSavePrivacy, 0); }} />
                    </div>
                  </div>
                </div>

                {/* Data */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Data & Privacy</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                          <Globe size={15} className="text-[var(--text-muted)]" />
                        </div>
                        <div>
                          <span className="text-[13px] font-medium text-[var(--text-primary)] block">Data Sharing</span>
                          <span className="text-[11px] text-[var(--text-muted)]">Help improve our services</span>
                        </div>
                      </div>
                      <ToggleSwitch value={dataSharing} onChange={(v) => { setDataSharing(v); setTimeout(handleSavePrivacy, 0); }} />
                    </div>

                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <Download size={15} className="text-[var(--text-muted)]" />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)] block">Export My Data</span>
                        <span className="text-[11px] text-[var(--text-muted)]">Download all your data</span>
                      </div>
                    </button>

                    {/* Delete Usage History */}
                    {!deleteUsageConfirm ? (
                      <button
                        onClick={() => setDeleteUsageConfirm(true)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-amber-500/10 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                          <Trash2 size={15} className="text-amber-400" />
                        </div>
                        <div>
                          <span className="text-[13px] font-medium text-amber-400 block">Delete Usage History</span>
                          <span className="text-[11px] text-[var(--text-muted)]">Remove all usage logs and analytics</span>
                        </div>
                      </button>
                    ) : (
                      <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                        <p className="text-[12px] text-[var(--text-primary)] font-medium mb-1">Delete all usage history?</p>
                        <p className="text-[11px] text-[var(--text-muted)] mb-3">This will permanently remove all usage events, token counts, and cost data from Logs. This cannot be undone.</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleDeleteUsageHistory}
                            disabled={deleteUsageLoading}
                            className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            {deleteUsageLoading ? "Deleting..." : "Delete permanently"}
                          </button>
                          <button
                            onClick={() => setDeleteUsageConfirm(false)}
                            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/10 transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                        <Trash2 size={15} className="text-red-400" />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-red-400 block">Delete Account</span>
                        <span className="text-[11px] text-[var(--text-muted)]">Permanently remove your data</span>
                      </div>
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleSavePrivacy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-[#7C6EE6] to-[#9B8AFB] text-white text-[13px] font-semibold hover:shadow-lg hover:shadow-[#9B8AFB]/25 transition-all duration-300 active:scale-[0.98]"
                >
                  <Save size={15} /> Save Changes
                </button>
              </div>
            )}

            {activePanel === "help" && (
              <div className="space-y-4">
                {/* FAQ */}
                <div>
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Frequently Asked Questions</p>
                  <div className="space-y-2">
                    {[
                      { q: "How do I change my AI model?", a: "Use the model selector in the chat input area to switch between different AI models." },
                      { q: "Can I export my conversations?", a: "Yes, go to Privacy & Security and click 'Export My Data' to download all your data." },
                      { q: "How do I create a project?", a: "Navigate to the Projects tab in the sidebar and click 'Create New Project'." },
                    ].map((faq) => (
                      <details key={faq.q} className="group rounded-xl border border-[var(--border)] overflow-hidden">
                        <summary className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors text-[13px] font-medium text-[var(--text-primary)]">
                          <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                          {faq.q}
                        </summary>
                        <p className="px-3 pb-3 pt-1 text-[12px] text-[var(--text-muted)] ml-8">{faq.a}</p>
                      </details>
                    ))}
                  </div>
                </div>

                {/* Contact */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Contact Us</p>
                  <div className="space-y-2">
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <Mail size={15} className="text-[var(--text-muted)]" />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)] block">Email Support</span>
                        <span className="text-[11px] text-[var(--text-muted)]">support@niaai.com</span>
                      </div>
                      <ExternalLink size={13} className="text-[var(--text-faint)] ml-auto" />
                    </button>
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <MessageCircle size={15} className="text-[var(--text-muted)]" />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)] block">Live Chat</span>
                        <span className="text-[11px] text-[var(--text-muted)]">Chat with our team</span>
                      </div>
                      <ExternalLink size={13} className="text-[var(--text-faint)] ml-auto" />
                    </button>
                  </div>
                </div>

                {/* App Info */}
                <div className="border-t border-[var(--border)] pt-4">
                  <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] text-center">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">NiaAI</p>
                    <p className="text-[11px] text-[var(--text-muted)]">Version 2.0.0</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Sidebar profile card mode
  if (sidebarMode) {
    return (
      <>
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent-border)] transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center text-white text-[13px] font-bold shrink-0">
              {user?.name ? user.name.charAt(0).toUpperCase() : "D"}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{user?.name || "Darshini ML"}</p>
              <p className="text-[11px] text-[var(--accent)] font-medium">Premium</p>
            </div>
            <Settings size={14} className="text-[var(--text-faint)] shrink-0" />
          </button>

          {isOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden z-50 animate-scale-in shadow-2xl shadow-black/40" style={{ transformOrigin: "bottom left" }}>
                {/* Menu Items */}
                <div className="p-1.5">
                  {menuItems.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => handleMenuClick(item.panel)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-all duration-200 group text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center group-hover:bg-[var(--accent-subtle)] transition-colors duration-200">
                        <item.icon size={15} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors duration-200" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text-primary)]">{item.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{item.desc}</p>
                      </div>
                      {item.badge && (
                        <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">{item.badge}</span>
                      )}
                    </button>
                  ))}

                  {/* Dark Mode Toggle */}
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                      {darkMode ? <Moon size={15} className="text-[var(--accent)]" /> : <Sun size={15} className="text-amber-400" />}
                    </div>
                    <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">Dark Mode</span>
                    <ToggleSwitch value={darkMode} onChange={setDarkMode} />
                  </div>
                </div>

                {/* Logout */}
                <div className="p-1.5 border-t border-[var(--border)]">
                  <button
                    onClick={() => { onLogout?.(); setIsOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/10 transition-all duration-200 group text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <LogOut size={15} className="text-red-400" />
                    </div>
                    <span className="text-[13px] font-medium text-red-400">Log Out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Panels */}
        {renderPanel()}
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl hover:bg-[var(--bg-hover)] transition-all duration-200 border border-transparent hover:border-[var(--border)]"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center text-white shadow-md shadow-[#c13bd9]/20 text-[13px] font-bold">
            {user?.name ? user.name.charAt(0).toUpperCase() : <User size={14} />}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-tight">{user?.name || "User"}</p>
            <p className="text-[10px] text-[var(--accent)] font-medium">Premium</p>
          </div>
          <ChevronDown
            size={12}
            className={`text-[var(--text-muted)] hidden sm:block transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

            <div className="absolute top-full right-0 mt-2 w-72 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden z-50 animate-scale-in shadow-2xl shadow-black/40">
              {/* User Header */}
              <div className="p-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center text-white shadow-lg shadow-[#c13bd9]/20 text-[17px] font-bold">
                    {user?.name ? user.name.charAt(0).toUpperCase() : <User size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold text-[var(--text-primary)]">{user?.name || "User"}</p>
                    <p className="text-[12px] text-[var(--text-muted)] truncate">{user?.email || "user@example.com"}</p>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full bg-gradient-to-r from-[#8b3dff] to-[#c13bd9] text-white tracking-wider">PRO</span>
                </div>
              </div>

              {/* Menu Items */}
              <div className="p-1.5">
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleMenuClick(item.panel)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-all duration-200 group text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center group-hover:bg-[var(--accent-subtle)] transition-colors duration-200">
                      <item.icon size={15} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors duration-200" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">{item.label}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{item.desc}</p>
                    </div>
                    {item.badge && (
                      <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">{item.badge}</span>
                    )}
                  </button>
                ))}

                {/* Dark Mode Toggle */}
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                    {darkMode ? <Moon size={15} className="text-[var(--accent)]" /> : <Sun size={15} className="text-amber-400" />}
                  </div>
                  <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">Dark Mode</span>
                  <ToggleSwitch value={darkMode} onChange={setDarkMode} />
                </div>
              </div>

              {/* Logout */}
              <div className="p-1.5 border-t border-[var(--border)]">
                <button
                  onClick={() => { onLogout?.(); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/10 transition-all duration-200 group text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <LogOut size={15} className="text-red-400" />
                  </div>
                  <span className="text-[13px] font-medium text-red-400">Log Out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal Panels */}
      {renderPanel()}
    </>
  );
}
