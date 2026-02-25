import { useState } from 'react';
import { api } from '../lib/api';

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New password and confirm password must match');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword,
        newPassword
      });
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="boxed shadow-panel w-full max-w-xl">
      <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold">Change Password</div>
      <form className="p-4 grid gap-3 text-sm" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1">
          Current Password
          <input
            type="password"
            className="focusable border border-tally-panelBorder bg-white p-2"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          New Password
          <input
            type="password"
            className="focusable border border-tally-panelBorder bg-white p-2"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>
        <label className="flex flex-col gap-1">
          Confirm New Password
          <input
            type="password"
            className="focusable border border-tally-panelBorder bg-white p-2"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-60"
        >
          {isSubmitting ? 'Updating...' : 'Update Password'}
        </button>
        {error && <div className="text-tally-warning">{error}</div>}
        {success && <div className="text-emerald-700">{success}</div>}
      </form>
    </div>
  );
}
