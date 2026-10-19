export const typeDefs = `#graphql
  "Task priority levels."
  enum Priority {
    LOW
    MEDIUM
    HIGH
  }

  "A task. All dates are ISO 8601 strings in UTC, e.g. 2026-11-01T12:00:00.000Z."
  type Task {
    id: ID!
    title: String!
    description: String
    completed: Boolean!
    priority: Priority!
    dueDate: String
    createdAt: String!
    updatedAt: String!
  }

  "A registered user. The password is never exposed."
  type User {
    id: ID!
    name: String!
    email: String!
    createdAt: String!
  }

  "Returned by register and login. Send the token as: Authorization: Bearer <token>"
  type AuthPayload {
    token: String!
    user: User!
  }

  input RegisterInput {
    name: String!
    "Stored lower-cased; must be unique."
    email: String!
    "8 to 72 characters."
    password: String!
  }

  input LoginInput {
    email: String!
    password: String!
  }

  type PriorityCount {
    priority: Priority!
    count: Int!
  }

  type TaskStatistics {
    totalTasks: Int!
    completedTasks: Int!
    pendingTasks: Int!
    tasksByPriority: [PriorityCount!]!
  }

  type DeleteTaskResponse {
    success: Boolean!
    message: String!
    "ID of the deleted task."
    id: ID!
  }

  input CreateTaskInput {
    "Required. Leading/trailing whitespace is trimmed; must not be empty."
    title: String!
    description: String
    "Defaults to MEDIUM."
    priority: Priority
    "ISO 8601 date or date-time, e.g. 2026-11-01 or 2026-11-01T12:00:00.000Z."
    dueDate: String
    "Defaults to false."
    completed: Boolean
  }

  "Only the fields you send are updated. Send null to clear description or dueDate."
  input UpdateTaskInput {
    title: String
    description: String
    completed: Boolean
    priority: Priority
    dueDate: String
  }

  "Filters are combined with AND."
  input TaskFilterInput {
    completed: Boolean
    priority: Priority
  }

  "All task operations require a valid token and only see the logged-in user's tasks."
  type Query {
    "The logged-in user."
    me: User!
    "All tasks, newest first, optionally filtered."
    tasks(filter: TaskFilterInput): [Task!]!
    "A single task. Fails with NOT_FOUND if it does not exist."
    task(id: ID!): Task!
    "Case-insensitive partial match on title. An empty search returns all tasks."
    searchTasks(search: String!): [Task!]!
    taskStatistics: TaskStatistics!
  }

  type Mutation {
    "Create an account and receive a token."
    register(input: RegisterInput!): AuthPayload!
    "Log in with email and password and receive a token."
    login(input: LoginInput!): AuthPayload!
    createTask(input: CreateTaskInput!): Task!
    updateTask(id: ID!, input: UpdateTaskInput!): Task!
    deleteTask(id: ID!): DeleteTaskResponse!
    "Marks a task as completed."
    completeTask(id: ID!): Task!
  }
`;
