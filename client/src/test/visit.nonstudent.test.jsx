import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FULL_PHONE, db } from '../mocks/db.js';
import VisitRecordingPage from '../pages/VisitRecordingPage.jsx';
import { renderWithProviders } from './utils.jsx';

async function toNonStudent(account) {
  await account.click(screen.getByLabelText('Non-student'));
}

describe('Visit recording: non-student flow', () => {
  it('lists up to 5 people for an existing phone and records a visit for the chosen one', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await toNonStudent(account);
    await account.type(screen.getByLabelText('Phone number'), `${FULL_PHONE}{Enter}`);

    const people = await screen.findAllByRole('button', { name: /demo person/i });
    expect(people).toHaveLength(5);
    expect(screen.getByText(/5 of 5 people registered/i)).toBeInTheDocument();

    await account.click(people[1]);
    expect(await screen.findByRole('heading', { name: 'Demo Person Two' })).toBeInTheDocument();
    expect(screen.getAllByText(/\(approx\.\)/i).length).toBeGreaterThan(0); // estimated age is labelled
    await screen.findByRole('option', { name: 'Fever' });
    await account.selectOptions(screen.getByLabelText('Health issue'), 'Fever');
    await account.type(screen.getByLabelText(/remedy/i), 'Paracetamol 500mg');
    await account.click(screen.getByRole('button', { name: /save visit/i }));
    expect(await screen.findByText('Visit saved for Demo Person Two')).toBeInTheDocument();
    expect(db.visits.at(-1)).toMatchObject({ patient_type: 'NON_STUDENT', health_issue: 'Fever' });
    expect(screen.getByLabelText('Phone number')).toHaveValue(''); // cleared for the next patient
  });

  it('points to "New" when no one is registered under the number', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await toNonStudent(account);
    await account.type(screen.getByLabelText('Phone number'), '9000000777{Enter}');
    expect(await screen.findByText(/no one is registered under 9000000777/i)).toBeInTheDocument();
    await account.click(screen.getByRole('button', { name: /register a new person/i }));
    expect(await screen.findByLabelText('Phone number')).toHaveValue('9000000777');
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('registers a new person (name, age, sex, phone, designation) and continues to the visit form', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await toNonStudent(account);
    await account.click(screen.getByLabelText('New'));
    await account.type(screen.getByLabelText('Phone number'), '9000000199');
    await account.type(screen.getByLabelText('Name'), 'Fresh Demo');
    await account.type(screen.getByLabelText('Age'), '29');
    await account.selectOptions(screen.getByLabelText('Sex'), 'F');
    await account.selectOptions(screen.getByLabelText('Designation'), 'STAFF');
    await account.click(screen.getByRole('button', { name: /register and continue/i }));

    expect(await screen.findByRole('heading', { name: 'Fresh Demo' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: /visit details/i })).toBeInTheDocument();
    const created = db.patients.find((p) => p.name === 'Fresh Demo');
    expect(created).toMatchObject({ phone_no: '9000000199', age_at_registration: 29, designation: 'STAFF' });
  });

  it('shows PHONE_LIMIT_REACHED clearly when a 6th person is added to a full number', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await toNonStudent(account);
    await account.click(screen.getByLabelText('New'));
    await account.type(screen.getByLabelText('Phone number'), FULL_PHONE);
    await account.type(screen.getByLabelText('Name'), 'Sixth Demo');
    await account.type(screen.getByLabelText('Age'), '33');
    await account.selectOptions(screen.getByLabelText('Sex'), 'M');
    await account.selectOptions(screen.getByLabelText('Designation'), 'WORKER');
    await account.click(screen.getByRole('button', { name: /register and continue/i }));

    expect(await screen.findByText('This phone number is full')).toBeInTheDocument();
    expect(screen.getByText(/5 people registered/i)).toBeInTheDocument();
    expect(db.patients.some((p) => p.name === 'Sixth Demo')).toBe(false);
    await account.click(screen.getByRole('button', { name: /show the people on this number/i }));
    expect(await screen.findAllByRole('button', { name: /demo person/i })).toHaveLength(5);
  });

  it('validates the new-person form before calling the server', async () => {
    const { account } = renderWithProviders(<VisitRecordingPage />);
    await toNonStudent(account);
    await account.click(screen.getByLabelText('New'));
    await account.click(screen.getByRole('button', { name: /register and continue/i }));
    expect(await screen.findByText('Enter the name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole-number age from 0 to 120.')).toBeInTheDocument();
  });
});
