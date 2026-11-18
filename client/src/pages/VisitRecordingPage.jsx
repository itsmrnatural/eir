import { useState } from 'react';
import Segmented from '../components/Segmented.jsx';
import NonStudentFlow from '../features/visit/NonStudentFlow.jsx';
import StudentFlow from '../features/visit/StudentFlow.jsx';

export default function VisitRecordingPage() {
  const [mode, setMode] = useState('STUDENT');
  return (
    <div className="page visit-page">
      <div className="page-head">
        <h1>Record visit</h1>
        <Segmented
          name="patient-kind"
          legend="Patient type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'STUDENT', label: 'Student' },
            { value: 'NON_STUDENT', label: 'Non-student' },
          ]}
        />
      </div>
      {mode === 'STUDENT' ? <StudentFlow key="student" /> : <NonStudentFlow key="non-student" />}
    </div>
  );
}
