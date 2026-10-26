pipeline {
    agent any

    parameters {
        booleanParam(name: 'SKIP_DEPLOY', defaultValue: false, description: '跳过重新构建/部署环境（环境已就绪时使用）')
        booleanParam(name: 'RUN_PERF_TEST', defaultValue: false, description: '是否执行 JMeter 性能测试')
        choice(name: 'PERF_SCENARIO', choices: ['baseline', 'mixed', 'spike', 'endurance'], description: '性能场景')
        string(name: 'THREADS', defaultValue: '50', description: '并发线程数')
        string(name: 'DURATION', defaultValue: '300', description: '压测时长（秒）')
        booleanParam(name: 'CLEANUP_AFTER', defaultValue: false, description: '结束后销毁环境')
        string(name: 'BASE_URL', defaultValue: 'http://localhost', description: '被测服务基础地址（容器内运行 Jenkins 时填 http://host.docker.internal）')
    }

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('准备') {
            steps {
                script {
                    env.GIT_COMMIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.GIT_BRANCH_NAME = sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
                    env.VERSION = "${env.GIT_BRANCH_NAME}-${env.GIT_COMMIT_SHORT}-b${env.BUILD_NUMBER}"
                    env.BASE_URL = params.BASE_URL
                    currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.VERSION}"
                }
                echo "本次合并版本：${env.VERSION}"
                sh 'docker version'
                sh 'docker compose version'
            }
        }

        stage('构建镜像') {
            when { expression { !params.SKIP_DEPLOY } }
            steps {
                sh 'docker compose build backend frontend'
            }
        }

        stage('部署环境') {
            when { expression { !params.SKIP_DEPLOY } }
            steps {
                sh 'docker compose up -d mysql redis rabbitmq backend frontend'
                // 等待后端健康检查通过
                sh '''
                    for i in $(seq 1 60); do
                      if curl -fsS http://backend:8080/actuator/health >/dev/null 2>&1 || \
                         curl -fsS "$BASE_URL:8080/actuator/health" >/dev/null 2>&1; then
                        echo "backend is healthy"; exit 0
                      fi
                      sleep 5
                    done
                    echo "backend 健康检查超时"; exit 1
                '''
            }
        }

        stage('冒烟检查') {
            steps {
                sh '''
                    curl -fsS "$BASE_URL:8080/api/products?page=0&size=1" | head -c 300
                    curl -fsS -o /dev/null -w "frontend:%{http_code}\\n" "$BASE_URL:8081/"
                '''
            }
        }

        stage('API 自动化测试') {
            steps {
                script {
                    env.API_RC = sh(
                        script: "docker compose -f docker-compose.test.yml run --rm -e REPORT_VERSION=${env.VERSION} playwright npx playwright test --project=api",
                        returnStatus: true
                    )
                }
            }
        }

        stage('UI 自动化测试') {
            steps {
                script {
                    env.UI_RC = sh(
                        script: "docker compose -f docker-compose.test.yml run --rm -e REPORT_VERSION=${env.VERSION} playwright npx playwright test --project=ui",
                        returnStatus: true
                    )
                }
            }
        }

        stage('生成 Allure 报告') {
            steps {
                sh "docker compose -f docker-compose.test.yml run --rm -e REPORT_VERSION=${env.VERSION} --entrypoint '' playwright bash -lc 'npx allure generate ../reports/${env.VERSION}/allure-results --clean -o ../reports/${env.VERSION}/allure-report || true'"
                // 从命名卷中取出报告（避免容器内外路径不一致的问题）
                sh "mkdir -p ${WORKSPACE}/reports && docker run --rm -v target_demo-reports:/r alpine tar -C /r -cf - . | tar -C ${WORKSPACE}/reports -xf -"
            }
        }

        stage('性能测试（可选）') {
            when { expression { params.RUN_PERF_TEST } }
            steps {
                sh "docker compose -f docker-compose.test.yml run --rm -e REPORT_VERSION=${env.VERSION} -e THREADS=${params.THREADS} -e DURATION=${params.DURATION} --entrypoint '' jmeter bash /jmeter/run-perf.sh ${params.PERF_SCENARIO}"
                sh "mkdir -p ${WORKSPACE}/reports && docker run --rm -v target_demo-reports:/r alpine tar -C /r -cf - . | tar -C ${WORKSPACE}/reports -xf -"
            }
        }

        stage('归档结果') {
            steps {
                archiveArtifacts artifacts: "reports/${env.VERSION}/**", allowEmptyArchive: true, fingerprint: true
                publishHTML(target: [
                    allowMissing         : true,
                    alwaysLinkToLastBuild: true,
                    keepAll              : true,
                    reportDir            : "reports/${env.VERSION}/playwright-report",
                    reportFiles          : 'index.html',
                    reportName           : "Playwright-${env.VERSION}"
                ])
                script {
                    if (env.API_RC != '0' || env.UI_RC != '0') {
                        echo "API_RC=${env.API_RC} UI_RC=${env.UI_RC}"
                        unstable('存在失败的自动化用例，请查看报告')
                    }
                }
            }
        }
    }

    post {
        always {
            echo "构建结束：${env.VERSION}，报告目录 reports/${env.VERSION}"
        }
        cleanup {
            script {
                if (params.CLEANUP_AFTER) {
                    sh 'docker compose down -v || true'
                }
            }
        }
    }
}
