import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OTHER } from '../features/visit/HealthIssueField.jsx';
import { clock } from '../lib/rfid.js';
import { db, pid } from '../mocks/db.js';
import VisitRecordingPage from '../pages/VisitRecordingPage.jsx';
import { renderWithProviders } from './utils.jsx';

const visitsOf = (id) => db.visits.filter((v) => v.patient_id === id).length;
const tap = (account, tag) => account.type(screen.getByLabelText(/rfid reader input/i), `${tag}{Enter}`);

async function fillAndSave(account, issueValue, remedy) {
  await screen.findByRole('option', { name: 'Fever' }); // health issues have loaded
  await account.selectOptions(screen.getByLabelText('Health issue'), issueValue);
  if (remedy) await account.type(screen.getByLabelText(/remedy/i), remedy);
  await account.click(screen.getByRole('button', { name: /save visit/i }));
}

describe('Visit recording: student card flow', () => {
  it('shows the tap state first, then records a visit for a tapped card and resets', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    expect(screen.getByRole('heading', { name: /tap card/i })).toBeInTheDocument();
    const before = visitsOf(pid(1));

    await tap(account, 'RFID-0001');
    expect(await screen.findByRole('heading', { name: 'Aanya Demo' })).toBeInTheDocument();
    expect(screen.getByText('251210001')).toBeInTheDocument(); // auto-filled roll number
    expect(screen.getByText(/recorded automatically/i)).toBeInTheDocument();

    await fillAndSave(account, 'Fever', 'Paracetamol 500mg');
    expect(await screen.findByText('Visit saved for Aanya Demo')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /tap card/i })).toBeInTheDocument(); // ready for the next patient
    expect(visitsOf(pid(1))).toBe(before + 1);
    const saved = db.visits.at(-1);
    expect(saved).toMatchObject({ health_issue: 'Fever', health_issue_is_custom: false, remedy: 'Paracetamol 500mg', recorded_by: 2 });
  });

  it('saves a free-text issue when "Other" is chosen', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-0003');
    await screen.findByRole('heading', { name: 'Meera Demo' });
    await screen.findByRole('option', { name: 'Fever' });
    await account.selectOptions(screen.getByLabelText('Health issue'), OTHER);
    await account.type(await screen.findByLabelText('Describe the issue'), 'Insect bite');
    await account.type(screen.getByLabelText(/remedy/i), 'Antihistamine cream');
    await account.click(screen.getByRole('button', { name: /save visit/i }));
    expect(await screen.findByText('Visit saved for Meera Demo')).toBeInTheDocument();
    expect(db.visits.at(-1)).toMatchObject({ health_issue: 'Insect bite', health_issue_is_custom: true });
  });

  it('asks before saving a duplicate visit, then re-sends with confirmation', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    const before = visitsOf(pid(2));
    await tap(account, 'RFID-0002');
    await screen.findByRole('heading', { name: 'Kabir Demo' });
    await fillAndSave(account, 'Headache', 'Paracetamol 500mg');

    expect(await screen.findByText(/this patient already has a visit at .+\. save another\?/i)).toBeInTheDocument();
    expect(visitsOf(pid(2))).toBe(before); // nothing saved yet
    await account.click(await screen.findByRole('button', { name: 'Save another' }));
    expect(await screen.findByText('Visit saved for Kabir Demo')).toBeInTheDocument();
    expect(visitsOf(pid(2))).toBe(before + 1);
  });

  it('keeps the visit unsaved when the duplicate question is cancelled', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    const before = visitsOf(pid(2));
    await tap(account, 'RFID-0002');
    await screen.findByRole('heading', { name: 'Kabir Demo' });
    await fillAndSave(account, 'Headache', 'Paracetamol 500mg');
    await screen.findByText(/already has a visit at/i);
    // the form has its own Cancel button, so scope to the dialog
    await account.click(await within(screen.getByRole('alertdialog')).findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/already has a visit at/i)).not.toBeInTheDocument();
    expect(visitsOf(pid(2))).toBe(before);
  });

  it('shows "Card not registered, contact admin" for an unknown card, with no registration option', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-NOPE');
    expect(await screen.findByText('Card not registered, contact admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /tap card/i })).toBeInTheDocument(); // still ready for another tap
  });

  it('explains a deactivated card', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-DEAD');
    expect(await screen.findByText(/card has been deactivated, contact admin/i)).toBeInTheDocument();
  });

  it('ignores slow, human-speed typing instead of looking up a card', async () => {
    let t = 0;
    const spy = vi.spyOn(clock, 'now').mockImplementation(() => (t += 300));
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-0001');
    expect(await screen.findByText(/looked like typing/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aanya Demo' })).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('Esc cancels the current patient and returns to the reader', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-0001');
    await screen.findByRole('heading', { name: 'Aanya Demo' });
    await account.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: /tap card/i })).toBeInTheDocument();
  });

  it('refuses to save without a health issue or remedy', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await tap(account, 'RFID-0001');
    await screen.findByRole('heading', { name: 'Aanya Demo' });
    const before = db.visits.length;
    await account.click(screen.getByRole('button', { name: /save visit/i }));
    expect(await screen.findByText('Choose a health issue.')).toBeInTheDocument();
    expect(db.visits.length).toBe(before);
  });
});
