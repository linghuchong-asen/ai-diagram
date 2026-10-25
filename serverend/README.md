# 流程图编辑器--后端

使用nest.js框架，有：登录模块、项目管理模块、文档保存模块。

# 登录模块

- 用户注册：使用到了bcrypt.js对密码加盐
- 用户登录：jwt token
- 设置头像：multer中间件

# 项目管理模块

使用mysql储存项目信息

# 文档保存模块

使用MongoDB储存编辑器的json数据

# 目录结构

```js

dasddasdjlasd
│  app.controller.spec.ts
│  app.controller.ts
│  app.module.ts
│  app.service.ts
│  main.ts
│
├─auth
│  │  auth.controller.spec.ts
│  │  auth.controller.ts
│  │  auth.guard.ts
│  │  auth.module.ts
│  │  auth.service.spec.ts
│  │  auth.service.ts
│  │  jwt.strategy.ts
│  │  local.strategy.ts
│  │
│  ├─dto
│  │      login.dto.ts
│  │
│  └─entities
│          auth.entity.ts
│
├─core
│  ├─filter
│  │  └─http-exception
│  │          http-exception.filter.spec.ts
│  │          http_exception.filter.ts
│  │
│  └─interceptor
│      │  skip.interceptor.ts
│      │
│      └─transform
│              transform.interceptor.spec.ts
│              transform.interceptor.ts
│
├─operationalModules  // 业务模块
│  ├─editorDocument
│  │  │  editor_document.controller.ts
│  │  │  editor_document.module.ts
│  │  │  editor_document.service.ts
│  │  │
│  │  ├─dto
│  │  │      save_editor_document.dto.ts
│  │  │
│  │  └─schemas
│  │          editor_document.schema.ts
│  │
│  ├─projectManager
│  │  │  project_manager.controller.spec.ts
│  │  │  project_manager.controller.ts
│  │  │  project_manager.module.ts
│  │  │  project_manager.service.spec.ts
│  │  │  project_manager.service.ts
│  │  │
│  │  ├─dto
│  │  │      create_project.dto.ts
│  │  │      project_response.dto.ts
│  │  │
│  │  └─entities
│  │          project_manager.entity.ts
│  │
│  └─projectSearch
│      │  project_search.controller.ts
│      │  project_search.module.ts
│      │  project_search.service.ts
│      │
│      └─mock
│              flowchart_mock_data.ts
│
├─public
│      avatar.jpg
│
├─user
│  │  user.controller.spec.ts
│  │  user.controller.ts
│  │  user.module.ts
│  │  user.service.spec.ts
│  │  user.service.ts
│  │
│  ├─dto
│  │      create_user.dto.ts
│  │      update_user.dto.ts
│  │      update_user_decorate.util.ts
│  │
│  └─entities
│          user.entity.ts
│
└─utils
    └─log
            logger.service.ts
```

# 启动项目

```js
pnpm start
```
