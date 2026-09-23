import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import OAuthSuccess from "./pages/OAuthSuccess.jsx";
import AcceptInvitation from "./pages/auth/AcceptInvitation.jsx";
import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
import ResetPassword from "./pages/auth/ResetPassword.jsx";
import Projects from "./pages/projects/Projects.jsx";
import CreateProject from "./pages/projects/CreateProject.jsx";
import ProjectDetails from "./pages/projects/ProjectDetails.jsx";
import EditProject from "./pages/projects/EditProject.jsx";
import Tasks from "./pages/tasks/Tasks.jsx";
import MyTasks from "./pages/tasks/MyTasks.jsx";
import TaskDetails from "./pages/tasks/TaskDetails.jsx";
import Members from "./pages/members/Members.jsx";
import Invitations from "./pages/invitations/Invitations.jsx";
import Activity from "./pages/activity/Activity.jsx";
import Settings from "./pages/settings/Settings.jsx";
import Questions from "./pages/questions/Questions.jsx";
import CreateQuestion from "./pages/questions/CreateQuestion.jsx";
import QuestionDetails from "./pages/questions/QuestionDetails.jsx";
import Monitoring from "./pages/monitoring/Monitoring.jsx";
import MonitoringDayDetail from "./pages/monitoring/MonitoringDayDetail.jsx";
import Chat from "./pages/chat/Chat.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/oauth-success" element={<OAuthSuccess />} />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects"
        element={
          <ProtectedRoute>
            <Projects />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/new"
        element={
          <ProtectedRoute>
            <CreateProject />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/edit"
        element={
          <ProtectedRoute>
            <EditProject />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/tasks/:taskId"
        element={
          <ProtectedRoute>
            <TaskDetails />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId"
        element={
          <ProtectedRoute>
            <ProjectDetails />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <Tasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-tasks"
        element={
          <ProtectedRoute>
            <MyTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/members"
        element={
          <ProtectedRoute>
            <Members />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invitations"
        element={
          <ProtectedRoute>
            <Invitations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/activity"
        element={
          <ProtectedRoute>
            <Activity />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questions"
        element={
          <ProtectedRoute>
            <Questions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questions/new"
        element={
          <ProtectedRoute>
            <CreateQuestion />
          </ProtectedRoute>
        }
      />
      <Route
        path="/monitoring"
        element={
          <ProtectedRoute>
            <Monitoring />
          </ProtectedRoute>
        }
      />
      <Route
        path="/monitoring/:userId"
        element={
          <ProtectedRoute>
            <MonitoringDayDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questions/:id"
        element={
          <ProtectedRoute>
            <QuestionDetails />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
