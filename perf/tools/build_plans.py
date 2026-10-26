#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
target_demo JMeter 压测脚本生成器（目标版本 JMeter 5.6.3，仅使用核心元件，不依赖任何插件）。

为什么要生成器而不是手写 8 份 jmx：
  8 个 plan 共用同一套「登录 / 浏览 / 下单支付 / 后台」片段，手写必然出现漂移
  （改了 order-pay 忘了改 stress-ramp）。这里把片段做成函数，一次生成全部 plan。
生成的 .jmx 是标准独立文件，可以直接用 JMeter GUI 打开，也可以 CLI 跑。

用法：
    python3 tools/build_plans.py            # 输出到 ../plans
    python3 tools/build_plans.py --out /tmp/plans

JMX 结构铁律（写错会导致 ListedHashTree cannot be cast to JMeterProperty）：
  每个 testElement 后面必须跟一个「兄弟」<hashTree>；绝不能把 hashTree 塞进元素内部。
  数值类属性（num_threads / ramp_time / duration / loops）一律用 stringProp，
  这样才能吃 -J 传入的 __P() 变量；只有字面量数字才用 intProp。
"""
import argparse
import os

# ---------------------------------------------------------------- 基础渲染


def esc(s):
    """XML 文本转义（属性值里的 & 和 < 必须转义）。"""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


class N:
    """一个 JMeter 测试元件。props 是已渲染好的属性行；children 是子元件列表。"""

    def __init__(self, tag, attrs, props=None, children=None):
        self.tag = tag
        self.attrs = attrs
        self.props = props or []
        self.children = children or []

    def render(self, ind=0):
        pad = "  " * ind
        a = " ".join(f'{k}="{v}"' for k, v in self.attrs.items())
        out = [f"{pad}<{self.tag} {a}>"]
        out += [f"{pad}  {p}" for p in self.props]
        out.append(f"{pad}</{self.tag}>")
        if self.children:
            out.append(f"{pad}<hashTree>")
            for c in self.children:
                out += c.render(ind + 2)
            out.append(f"{pad}</hashTree>")
        else:
            out.append(f"{pad}<hashTree/>")
        return out


def sp(name, value):
    return f'<stringProp name="{name}">{esc(value)}</stringProp>'


def bp(name, value):
    return f'<boolProp name="{name}">{str(value).lower()}</boolProp>'


def ip(name, value):
    return f'<intProp name="{name}">{value}</intProp>'


def P(name, default=""):
    """JMeter 属性占位：${__P(name,default)}"""
    return "${__P(%s,%s)}" % (name, default)


def el(tag, testname, guiclass=None, testclass=None, props=None, children=None):
    return N(tag, {
        "guiclass": guiclass or tag + "Gui",
        "testclass": testclass or tag,
        "testname": testname,
        "enabled": "true",
    }, props, children)


# ---------------------------------------------------------------- 元件工厂

def render_elementprop(node, ind=0):
    """渲染 elementProp（如 ThreadGroup.main_controller、TestPlan.user_defined_variables）。

    注意：elementProp 是「属性」而不是测试元件，后面绝不能跟 <hashTree/>，
    否则 JMeter 加载时会报 ListedHashTree cannot be cast to JMeterProperty。
    """
    pad = "  " * ind
    a = " ".join(f'{k}="{v}"' for k, v in node.attrs.items())
    out = [f"{pad}<{node.tag} {a}>"]
    out += [f"{pad}  {p}" for p in node.props]
    out.append(f"{pad}</{node.tag}>")
    return out


def http_defaults():
    return N("ConfigTestElement", {
        "guiclass": "HttpDefaultsGui", "testclass": "ConfigTestElement",
        "testname": "HTTP Request Defaults", "enabled": "true",
    }, [
        arguments_xml([]),  # 必须带空的 HTTPsampler.Arguments，否则 JMeter 报 Property unset
        sp("HTTPSampler.domain", "${host}"),
        sp("HTTPSampler.port", "${port}"),
        sp("HTTPSampler.protocol", "${protocol}"),
        sp("HTTPSampler.contentEncoding", "UTF-8"),
        sp("HTTPSampler.path", ""),
        sp("HTTPSampler.connect_timeout", P("connectTimeout", 5000)),
        sp("HTTPSampler.response_timeout", P("responseTimeout", 30000)),
    ])


def arguments_xml(items):
    """把参数容器渲染成可嵌入 props 的多行字符串（N.props 里已缩进一级）。"""
    if not items:
        return ('<elementProp name="HTTPsampler.Arguments" elementType="Arguments" '
                'guiclass="HTTPArgumentsPanel" testclass="Arguments" '
                'testname="User Defined Variables" enabled="true">\n'
                '  <collectionProp name="Arguments.arguments"/>\n'
                '</elementProp>')
    parts = ['<elementProp name="HTTPsampler.Arguments" elementType="Arguments" '
             'guiclass="HTTPArgumentsPanel" testclass="Arguments" '
             'testname="User Defined Variables" enabled="true">',
             '  <collectionProp name="Arguments.arguments">']
    for k, v, encode in items:
        parts += [
            f'    <elementProp name="{esc(k)}" elementType="HTTPArgument">',
            f'      <boolProp name="HTTPArgument.always_encode">{str(encode).lower()}</boolProp>',
            f'      <stringProp name="Argument.value">{esc(v)}</stringProp>',
            '      <stringProp name="Argument.metadata">=</stringProp>',
            '      <boolProp name="HTTPArgument.use_equals">true</boolProp>',
            f'      <stringProp name="Argument.name">{esc(k)}</stringProp>',
            '    </elementProp>',
        ]
    parts += ['  </collectionProp>', '</elementProp>']
    return "\n".join(parts)


def header_manager(name, headers):
    inner = []
    for k, v in headers:
        inner += [
            '    <elementProp name="" elementType="Header">',
            f'      <stringProp name="Header.name">{esc(k)}</stringProp>',
            f'      <stringProp name="Header.value">{esc(v)}</stringProp>',
            '    </elementProp>',
        ]
    return N("HeaderManager", {
        "guiclass": "HeaderPanel", "testclass": "HeaderManager",
        "testname": name, "enabled": "true",
    }, ["<collectionProp name=\"HeaderManager.headers\">"] + inner + ["</collectionProp>"])


def cookie_manager():
    return N("CookieManager", {
        "guiclass": "CookiePanel", "testclass": "CookieManager",
        "testname": "HTTP Cookie Manager", "enabled": "true",
    }, [
        '<collectionProp name="CookieManager.cookies"/>',
        bp("CookieManager.clearEachIteration", False),
    ])


def csv_data(name, filename, var_names, ignore_first_line=True):
    return N("CSVDataSet", {
        "guiclass": "TestBeanGUI", "testclass": "CSVDataSet",
        "testname": name, "enabled": "true",
    }, [
        sp("filename", filename),
        sp("fileEncoding", "UTF-8"),
        sp("variableNames", var_names),
        sp("delimiter", ","),
        bp("quotedData", False),
        bp("recycle", True),
        bp("stopThread", False),
        sp("shareMode", "shareMode.all"),
        bp("ignoreFirstLine", ignore_first_line),
    ])


def json_extractor(name, var, jsonpath, default="NOT_FOUND"):
    return el("JSONPostProcessor", name,
              guiclass="JSONPostProcessorGui", testclass="JSONPostProcessor", props=[
                  sp("JSONPostProcessor.referenceNames", var),
                  sp("JSONPostProcessor.jsonPathExprs", jsonpath),
                  sp("JSONPostProcessor.match_numbers", 1),
                  sp("JSONPostProcessor.defaultValues", default),
              ])


def json_assert(name, path="$.code", expected="0"):
    return el("JSONPathAssertion", name,
              guiclass="JSONPathAssertionGui", testclass="JSONPathAssertion", props=[
                  sp("JSON_PATH", path),
                  sp("EXPECTED_VALUE", expected),
                  bp("JSONVALIDATION", True),
                  bp("EXPECT_NULL", False),
                  bp("INVERT", False),
                  bp("ISREGEX", False),
              ])


def duration_assert(name, ms):
    return el("DurationAssertion", name,
              guiclass="DurationAssertionGui", testclass="DurationAssertion", props=[
                  sp("DurationAssertion.duration", ms),
              ])


def http_code_assert(name="HTTP 200", code="200"):
    return el("ResponseAssertion", name,
              guiclass="AssertionGui", testclass="ResponseAssertion", props=[
                  '<collectionProp name="Asserion.test_strings">',
                  f'  <stringProp name="-1">{code}</stringProp>',
                  '</collectionProp>',
                  sp("Assertion.custom_message", ""),
                  sp("Assertion.test_field", "Assertion.response_code"),
                  bp("Assertion.assume_success", False),
                  ip("Assertion.test_type", 8),  # 8 = Equals
              ])


def constant_timer(name, delay):
    return el("ConstantTimer", name, guiclass="ConstantTimerGui", testclass="ConstantTimer",
              props=[sp("ConstantTimer.delay", delay)])


def uniform_timer(name, base_delay, random_range):
    return el("UniformRandomTimer", name,
              guiclass="UniformRandomTimerGui", testclass="UniformRandomTimer", props=[
                  sp("ConstantTimer.delay", base_delay),
                  sp("RandomTimer.range", random_range),
              ])


def thread_group(name, threads, ramp, duration, delay=0, children=None, on_error="continue"):
    loop = N("elementProp", {
        "name": "ThreadGroup.main_controller", "elementType": "LoopController",
        "guiclass": "LoopControlPanel", "testclass": "LoopController",
        "testname": "Loop Controller", "enabled": "true",
    }, [
        bp("LoopController.continue_forever", True),
        sp("LoopController.loops", "-1"),   # 配合 scheduler + duration
    ])
    props = render_elementprop(loop, 1)
    return N("ThreadGroup", {
        "guiclass": "ThreadGroupGui", "testclass": "ThreadGroup",
        "testname": name, "enabled": "true",
    }, props + [
        sp("ThreadGroup.on_sample_error", on_error),
        sp("ThreadGroup.num_threads", threads),
        sp("ThreadGroup.ramp_time", ramp),
        bp("ThreadGroup.scheduler", True),
        sp("ThreadGroup.duration", duration),
        sp("ThreadGroup.delay", delay),
    ], children)


def once_only(name, children):
    return el("OnceOnlyController", name,
              guiclass="OnceOnlyControllerGui", testclass="OnceOnlyController",
              props=[bp("OnceOnlyController.continue_forever", False)], children=children)


def transaction(name, children, include_timers=False):
    """事务控制器。

    属性名已核对 5.6.3 的 TransactionControllerSchema：是 TransactionController.parent，
    不是 generateParentSample（写错会被静默忽略，表现为没有任何父样本）。

    父采样默认关闭（-JgenParent=true 打开）：打开后 JMeter 只把父样本写进 JTL，
    子采样变成 subresult 不再单独落盘，Grafana/HTML 报告就看不到按接口的拆分指标了。
    默认关闭可以保留全部接口级指标；需要端到端耗时时再打开并配合
    -Jjmeter.save.saveservice.subresults=true。
    """
    return el("TransactionController", name,
              guiclass="TransactionControllerGui", testclass="TransactionController", props=[
                  bp("TransactionController.parent", P("genParent", "false")),
                  bp("TransactionController.includeTimers", include_timers),
              ], children=children)


def think(sampler, base=None, rng=None, name="思考时间"):
    """把定时器挂成采样器的子节点。

    关键：定时器放在「控制器层」会对该层每一个采样器都生效（4 个请求 × 2 个定时器 = 8 次暂停），
    事务耗时会因此被放大到数秒，SLA 直接失真。挂成采样器的子节点才只作用于该采样器。
    """
    sampler.children.append(uniform_timer(
        name, base or P("thinkMin", 300), rng or P("thinkRange", 1200)))
    return sampler


def while_controller(name, condition, children):
    return el("WhileController", name,
              guiclass="WhileControllerGui", testclass="WhileController",
              props=[sp("WhileController.condition", condition)], children=children)


def if_controller(name, condition, children):
    return el("IfController", name,
              guiclass="IfControllerPanel", testclass="IfController", props=[
                  sp("IfController.condition", condition),
                  bp("IfController.evaluateAll", False),
                  bp("IfController.useExpression", True),
              ], children=children)


def counter(name, var, per_user=True, start=1, incr=1):
    return el("CounterConfig", name, guiclass="CounterConfigGui", testclass="CounterConfig",
              props=[
                  sp("CounterConfig.start", start),
                  sp("CounterConfig.end", ""),
                  sp("CounterConfig.incr", incr),
                  sp("CounterConfig.name", var),
                  sp("CounterConfig.format", ""),
                  bp("CounterConfig.per_user", per_user),
                  bp("CounterConfig.reset_on_tg_iteration", True),
              ])


def http(name, method, path, body=None, params=None):
    props = []
    if body is not None:
        props.append(bp("HTTPSampler.postBodyRaw", True))
        props.append(arguments_xml_raw(body))
    else:
        props.append(arguments_xml(params or []))
    props += [
        sp("HTTPSampler.domain", ""),
        sp("HTTPSampler.port", ""),
        sp("HTTPSampler.protocol", ""),
        sp("HTTPSampler.contentEncoding", ""),
        sp("HTTPSampler.path", path),
        sp("HTTPSampler.method", method),
        bp("HTTPSampler.follow_redirects", True),
        bp("HTTPSampler.auto_redirects", False),
        bp("HTTPSampler.use_keepalive", True),
        bp("HTTPSampler.DO_MULTIPART_POST", False),
        sp("HTTPSampler.embedded_url_re", ""),
        sp("HTTPSampler.connect_timeout", ""),
        sp("HTTPSampler.response_timeout", ""),
    ]
    return N("HTTPSamplerProxy", {
        "guiclass": "HttpTestSampleGui", "testclass": "HTTPSamplerProxy",
        "testname": name, "enabled": "true",
    }, props)


def arguments_xml_raw(body):
    """POST 原始 body：postBodyRaw=true + 一个空名 HTTPArgument 承载整段文本。"""
    return ('<elementProp name="HTTPsampler.Arguments" elementType="Arguments" '
            'guiclass="HTTPArgumentsPanel" testclass="Arguments" '
            'testname="User Defined Variables" enabled="true">\n'
            '  <collectionProp name="Arguments.arguments">\n'
            '    <elementProp name="" elementType="HTTPArgument">\n'
            '      <boolProp name="HTTPArgument.always_encode">false</boolProp>\n'
            f'      <stringProp name="Argument.value">{esc(body)}</stringProp>\n'
            '      <stringProp name="Argument.metadata">=</stringProp>\n'
            '    </elementProp>\n'
            '  </collectionProp>\n'
            '</elementProp>')


def backend_listener_influxdb():
    """InfluxDB v2 Backend Listener。JMeter 5.6.3 自带，无需插件。

    已核对（从 ApacheJMeter_components.jar 里提取常量池确认）：
      - 类名是 InfluxdbBackendListenerClient（小写 db，不是 InfluxDBBackendListenerClient）
      - token 参数名是 influxdbToken
      - HttpMetricsSender 用的 Authorization 头是 "Token <token>"，InfluxDB 2.x 也认这个格式
    """
    # 注意：arguments 必须是 elementProp(elementType=Arguments) 包 collectionProp，
    # 直接写 <collectionProp name="arguments"> 会被反序列化成 ArrayList，
    # 触发 ClassCastException 并导致整个测试 abort。
    inner = ""
    for k, v in [
        # 发送器实现类：不传会在 initInfluxdbMetricsManager 里 Class.forName(null) 抛 NPE
        ("influxdbMetricsSender",
         "org.apache.jmeter.visualizers.backend.influxdb.HttpMetricsSender"),
        ("testTitle", "target_demo"),
        ("influxdbUrl", "http://${influxHost}:8086/api/v2/write?org=${influxOrg}&bucket=${influxBucket}"),
        ("influxdbToken", "${influxToken}"),
        ("application", "${__P(appName,shop-demo)}"),
        ("measurement", "jmeter"),
        ("summaryOnly", "false"),
        ("samplersRegex", "^((?!Influx).)*"),
        ("percentiles", "50;90;95;99"),
        ("useRegexForSamplerList", "true"),
        ("recordSubSamples", "true"),
    ]:
        inner += (f'    <elementProp name="{k}" elementType="Argument">\n'
                  f'      <stringProp name="Argument.name">{k}</stringProp>\n'
                  f'      <stringProp name="Argument.value">{esc(v)}</stringProp>\n'
                  f'      <stringProp name="Argument.metadata">=</stringProp>\n'
                  '    </elementProp>\n')
    props = [
        sp("classname", "org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient"),
        '<elementProp name="arguments" elementType="Arguments" guiclass="ArgumentsPanel" '
        'testclass="Arguments" testname="User Defined Variables" enabled="true">',
        '  <collectionProp name="Arguments.arguments">',
        inner.rstrip("\n"),
        '  </collectionProp>',
        '</elementProp>',
    ]
    return N("BackendListener", {
        "guiclass": "BackendListenerGui", "testclass": "BackendListener",
        "testname": "InfluxDB2 Backend Listener", "enabled": "true",
    }, props)


def user_defined_variables(pairs):
    """TestPlan 上的 User Defined Variables（elementProp 形式）。"""
    inner = []
    for k, v in pairs:
        inner += [
            f'    <elementProp name="{esc(k)}" elementType="Argument">',
            f'      <stringProp name="Argument.name">{esc(k)}</stringProp>',
            f'      <stringProp name="Argument.value">{esc(v)}</stringProp>',
            '      <stringProp name="Argument.metadata">=</stringProp>',
            '    </elementProp>',
        ]
    return N("elementProp", {
        "name": "TestPlan.user_defined_variables", "elementType": "Arguments",
        "guiclass": "ArgumentsPanel", "testclass": "Arguments",
        "testname": "User Defined Variables", "enabled": "true",
    }, ["<collectionProp name=\"Arguments.arguments\">"] + inner + ["</collectionProp>"])


def test_plan(name, comment, udv_pairs, children):
    udv = user_defined_variables(udv_pairs)
    props = render_elementprop(udv, 1)
    tp = N("TestPlan", {
        "guiclass": "TestPlanGui", "testclass": "TestPlan",
        "testname": name, "enabled": "true",
    }, [sp("TestPlan.comments", comment),
        bp("TestPlan.functional_mode", False),
        bp("TestPlan.serialize_threadgroups", False)] + props + [
        sp("TestPlan.user_define_classpath", "")], children)
    return tp


# ---------------------------------------------------------------- 公共片段

UDV = [
    ("protocol", P("protocol", "http")),
    ("host", P("host", "backend")),
    ("port", P("port", "8080")),
    ("usersFile", P("usersFile", "data/users.csv")),
    ("productsFile", P("productsFile", "data/products.csv")),
    ("adminUser", P("adminUser", "admin")),
    ("adminPass", P("adminPass", "admin123")),
    ("payType", P("payType", "ALIPAY")),
    ("payOutcome", P("payOutcome", "SUCCESS")),
    ("maxPoll", P("maxPoll", "20")),
    ("pollIntervalMs", P("pollIntervalMs", "500")),
    ("influxHost", P("influxHost", "influxdb")),
    ("influxOrg", P("influxOrg", "shop")),
    ("influxBucket", P("influxBucket", "jmeter")),
    ("influxToken", P("influxToken", "shop-demo-token-1234567890")),
    ("listSize", P("listSize", "20")),
    ("hotLimit", P("hotLimit", "10")),
    ("adminSize", P("adminSize", "50")),
]

JSON_HEADER = header_manager("HTTP Header Manager - JSON", [("Content-Type", "application/json")])
AUTH_HEADER = header_manager("HTTP Header Manager - JWT",
                             [("Authorization", "Bearer ${token}")])


def csv_block(users=True, products=True):
    out = []
    if users:
        out.append(csv_data("CSV - 用户账号", "${usersFile}", "username,password"))
    if products:
        out.append(csv_data("CSV - 商品参数", "${productsFile}",
                            "productId,keyword,categoryId,quantity"))
    return out


def login_block(tag="登录(Once Only)", admin=False, duration_ms=None):
    if admin:
        body = '{"username":"${adminUser}","password":"${adminPass}"}'
        name = f"{tag} - 管理员"
    else:
        body = '{"username":"${username}","password":"${password}"}'
        name = tag
    sampler = http(name, "POST", "/api/auth/login", body=body)
    sampler.children = [
        json_extractor("提取 accessToken", "token", "$.data.accessToken"),
        json_assert("业务码=0"),
        http_code_assert("HTTP 200"),
        duration_assert("登录 ≤ ${__P(loginMaxMs,2000)}ms", P("loginMaxMs", 2000)),
    ]
    return once_only("Once Only - 登录", [sampler])


def browse_steps():
    """S1 浏览型用户：列表 → 详情（走缓存）→ 分类 → 热销"""
    lst = http("GET 商品列表(分页+关键字)", "GET", "/api/products", params=[
        ("keyword", "${keyword}", True),
        ("page", "0", False),
        ("size", "${listSize}", False),
    ])
    lst.children = [json_assert("业务码=0"),
                    duration_assert("列表 ≤ ${__P(listMaxMs,800)}ms", P("listMaxMs", 800))]

    detail = http("GET 商品详情(走 Redis 缓存)", "GET", "/api/products/${productId}")
    detail.children = [json_extractor("提取 cached 标记", "cached", "$.data.cached"),
                       json_assert("业务码=0"),
                       duration_assert("详情 ≤ ${__P(detailMaxMs,500)}ms", P("detailMaxMs", 500))]

    cats = http("GET 分类列表", "GET", "/api/categories")
    cats.children = [json_assert("业务码=0")]

    hot = http("GET 热销商品(纯缓存读)", "GET", "/api/products/hot", params=[
        ("limit", "${hotLimit}", False)])
    hot.children = [json_assert("业务码=0")]

    return [
        think(lst, name="思考时间(进入列表前)"),
        think(detail, name="思考时间(点进详情前)"),
        cats,
        think(hot, base=P("loopThinkMin", 500), rng=P("loopThinkRange", 2000),
              name="迭代思考时间"),
    ]


def order_pay_steps(include_cart=True, include_pay=True, include_poll=True,
                    include_order_query=True):
    """S2 购买型用户：加购 → 下单 →（可选）支付 →（可选）轮询终态 →（可选）查订单"""
    steps = []

    if include_cart:
        cart_add = http("POST 加入购物车", "POST", "/api/cart/items",
                        body='{"productId":${productId},"quantity":${quantity}}')
        cart_add.children = [json_assert("业务码=0")]
        cart_view = http("GET 查看购物车", "GET", "/api/cart")
        cart_view.children = [json_assert("业务码=0")]
        think(cart_add, name="思考时间(加购前)")
        steps += [cart_add, cart_view]

    order_body = ('{"items":[{"productId":${productId},"quantity":${quantity}}],'
                  '"receiverName":"${username}","receiverPhone":"13800000000",'
                  '"receiverAddress":"压测地址-${username}"}')
    create = http("POST 下单(乐观锁扣库存)", "POST", "/api/orders", body=order_body)
    create.children = [
        json_extractor("提取 orderNo", "orderNo", "$.data.orderNo"),
        json_assert("业务码=0"),
        http_code_assert("HTTP 200"),
        duration_assert("下单 ≤ ${__P(orderMaxMs,1500)}ms", P("orderMaxMs", 1500)),
    ]
    steps.append(create)

    if include_pay:
        pay_body = ('{"orderNo":"${orderNo}","payType":"${payType}","outcome":"${payOutcome}"}')
        pay = http("POST 发起支付(mock 网关)", "POST", "/api/payments", body=pay_body)
        pay.children = [
            json_extractor("提取 tradeNo", "tradeNo", "$.data.tradeNo"),
            json_extractor("提取 支付状态", "payStatus", "$.data.status"),
            json_assert("业务码=0"),
            http_code_assert("HTTP 200"),
            duration_assert("支付发起 ≤ ${__P(payMaxMs,800)}ms", P("payMaxMs", 800)),
        ]
        steps.append(pay)

    if include_pay and include_poll:
        query = http("GET 支付单状态(轮询)", "GET", "/api/payments/${tradeNo}")
        query.children = [
            json_extractor("提取 支付状态", "payStatus", "$.data.status"),
            json_assert("业务码=0"),
        ]
        # 未落终态才继续轮询；最多 maxPoll 次，避免死循环
        cond = ("${__groovy((vars.get('payStatus') == null || vars.get('payStatus') == 'PROCESSING') "
                "&amp;&amp; (vars.get('pollCount') == null || (vars.get('pollCount') as int) &lt; "
                "${__P(maxPoll,20)}),)}")
        query.children.append(constant_timer("轮询间隔", "${pollIntervalMs}"))
        steps.append(while_controller("While - 轮询支付终态(上限 ${maxPoll} 次)", cond, [
            counter("Counter - 轮询次数", "pollCount"),
            query,
        ]))

    if include_order_query:
        oq = http("GET 订单详情(终态校验)", "GET", "/api/orders/${orderNo}")
        oq.children = [json_assert("业务码=0")]
        think(oq, base=P("loopThinkMin", 1000), rng=P("loopThinkRange", 3000),
              name="迭代思考时间")
        steps.append(oq)

    return steps


def admin_steps():
    lst = http("GET 后台订单分页", "GET", "/api/admin/orders", params=[
        ("page", "0", False),
        ("size", "${adminSize}", False),
    ])
    lst.children = [json_assert("业务码=0"), http_code_assert("HTTP 200")]
    stats = http("GET 后台订单统计", "GET", "/api/admin/orders/stats")
    stats.children = [json_assert("业务码=0")]
    think(stats, base=P("loopThinkMin", 2000), rng=P("loopThinkRange", 5000),
          name="迭代思考时间")
    return [lst, stats]


def tg_login_browse(name, threads, ramp, duration, delay=0):
    children = csv_block() + [
        login_block(),
        AUTH_HEADER,
        transaction("S1-商品浏览事务", browse_steps()),
    ]
    return thread_group(name, threads, ramp, duration, delay, children)


def tg_login_order_pay(name, threads, ramp, duration, delay=0,
                       include_poll=True, include_cart=True):
    children = csv_block() + [
        login_block(),
        AUTH_HEADER,
        transaction("S2-下单支付事务", order_pay_steps(include_cart=include_cart,
                                                  include_poll=include_poll)),
    ]
    return thread_group(name, threads, ramp, duration, delay, children)


def tg_admin(name, threads, ramp, duration, delay=0):
    children = [
        login_block("登录(Once Only)", admin=True),
        AUTH_HEADER,
        transaction("S3-后台运营事务", admin_steps()),
    ]
    return thread_group(name, threads, ramp, duration, delay, children)


# ---------------------------------------------------------------- Plan 定义

def plan(name, comment, thread_groups, extra_udv=None):
    children = [
        http_defaults(),
        JSON_HEADER,
        cookie_manager(),
        backend_listener_influxdb(),
    ] + thread_groups
    return test_plan(name, comment, UDV + (extra_udv or []), children)


def build_all(out_dir):
    plans = {}

    # 1. 浏览场景
    plans["shop-browse.jmx"] = plan(
        "Shop Demo - 浏览场景 (S1)",
        "S1 浏览型用户：登录 → 商品列表(关键字分页) → 商品详情(走 Redis 缓存) → 分类 → 热销。"
        "典型参数: -Jthreads=60 -JrampUp=60 -Jduration=600",
        [tg_login_browse("TG-浏览用户", P("threads", 60), P("rampUp", 60), P("duration", 600))])

    # 2. 下单支付全链路
    plans["shop-order-pay.jmx"] = plan(
        "Shop Demo - 下单支付全链路 (S2)",
        "S2 购买型用户：登录 → 加购 → 下单(乐观锁扣库存) → 发起支付 → 轮询支付终态 → 查订单。"
        "典型参数: -Jthreads=30 -JrampUp=60 -Jduration=600",
        [tg_login_order_pay("TG-下单支付用户", P("threads", 30), P("rampUp", 60), P("duration", 600))])

    # 3. 混合场景 6:3:1
    plans["shop-mixed.jmx"] = plan(
        "Shop Demo - 混合场景 (S1:S2:S3 = 6:3:1)",
        "贴近真实流量配比。分别用 -JthreadsBrowse / -JthreadsOrder / -JthreadsAdmin 控制。"
        "默认 60/30/10，总并发 100。",
        [
            tg_login_browse("TG-浏览用户(60%)", P("threadsBrowse", 60), P("rampUp", 60), P("duration", 600)),
            tg_login_order_pay("TG-下单支付用户(30%)", P("threadsOrder", 30), P("rampUp", 60), P("duration", 600)),
            tg_admin("TG-后台运营(10%)", P("threadsAdmin", 10), P("rampUp", 60), P("duration", 600)),
        ])

    # 4. 突发场景（核心 ThreadGroup 用「延迟启动」模拟 爬升→高压→冷却 三段）
    plans["shop-spike.jmx"] = plan(
        "Shop Demo - 突发流量 (spike)",
        "三段式：TG1 30s 内拉到 300 并发并保持；TG2 延迟启动做冷却期观察。"
        "看限流/队列/连接池在瞬时冲击下的表现与恢复。",
        [
            tg_login_browse("TG-突发浏览(爬升+保持)", P("spikeThreads", 200), P("spikeRamp", 30),
                            P("spikeHold", 300), delay="0"),
            tg_login_order_pay("TG-突发下单(爬升+保持)", P("spikeOrderThreads", 100), P("spikeRamp", 30),
                               P("spikeHold", 300), delay="0"),
            tg_login_browse("TG-冷却期观察(释放恢复)", P("coolThreads", 10), "10",
                            P("coolDuration", 300), delay=P("coolDelay", 330)),
        ])

    # 5. 稳定性场景
    plans["shop-endurance.jmx"] = plan(
        "Shop Demo - 稳定性/耐久 (endurance)",
        "长时间恒定负载，观察内存泄漏、MQ 堆积、连接泄漏、慢查询累积。"
        "默认 2h: -Jduration=7200 -JthreadsBrowse=60 -JthreadsOrder=30 -JthreadsAdmin=10",
        [
            tg_login_browse("TG-浏览用户(常驻)", P("threadsBrowse", 60), P("rampUp", 60), P("duration", 7200)),
            tg_login_order_pay("TG-下单支付用户(常驻)", P("threadsOrder", 30), P("rampUp", 60), P("duration", 7200)),
            tg_admin("TG-后台运营(常驻)", P("threadsAdmin", 10), P("rampUp", 60), P("duration", 7200)),
        ])

    # 6. 压力 - 阶梯加压（P0 预热 / P1 递增 / P2 临界保持 / P4 释放恢复）
    #    每个阶梯用「scheduler + duration」让上一个阶梯自行结束，实现只靠核心 ThreadGroup 的阶梯。
    steps = [
        ("P0-预热", P("warmThreads", 10), "30", P("warmDuration", 120), "0"),
        ("P1-并发50", P("step1Threads", 50), "30", P("stepDuration", 300), P("step0Delay", 120)),
        ("P1-并发100", P("step2Threads", 100), "30", P("stepDuration", 300), P("step1Delay", 420)),
        ("P1-并发200", P("step3Threads", 200), "30", P("stepDuration", 300), P("step2Delay", 720)),
        ("P1-并发400", P("step4Threads", 400), "30", P("stepDuration", 300), P("step3Delay", 1020)),
        ("P1-并发800", P("step5Threads", 800), "30", P("stepDuration", 300), P("step4Delay", 1320)),
        ("P2-临界点保持", P("holdThreads", 200), "60", P("holdDuration", 1200), P("holdDelay", 1620)),
        ("P4-释放恢复观察", P("coolThreads", 5), "10", P("coolDuration", 600), P("coolDelay", 2820)),
    ]
    plans["stress-ramp.jmx"] = plan(
        "Shop Demo - 压力测试 阶梯加压 (P0→P4)",
        "阶梯不降回：每个台阶用 scheduler duration 自行结束，下一台阶延迟接力，"
        "只用核心 ThreadGroup 实现递增。停止条件见 notes/压力测试方案.md。",
        [tg_login_order_pay(f"TG-{n}", t, r, d, delay=dl) for n, t, r, d, dl in steps])

    # 7. 压力 - 尖峰冲击（P3）
    plans["stress-spike.jmx"] = plan(
        "Shop Demo - 压力测试 尖峰冲击 (P3)",
        "基线负载之上叠加 2 倍拐点的瞬时尖峰，观察拒绝连接/错误率尖刺，随后进入恢复观察。",
        [
            tg_login_order_pay("TG-P3-基线负载", P("baseThreads", 50), "60", P("baseDuration", 600), delay="0"),
            tg_login_order_pay("TG-P3-尖峰冲击", P("spikeThreads", 800), P("spikeRamp", 120),
                               P("spikeHold", 180), delay=P("spikeDelay", 180)),
            tg_login_order_pay("TG-P4-释放恢复", P("coolThreads", 5), "10",
                               P("coolDuration", 600), delay=P("coolDelay", 540)),
        ])

    # 8. 压力 - 分层压测（-Jlayer=1..6 切换，逐层剥离瓶颈）
    # L1/L2 是公开接口不需要登录；L3 及以后需要 JWT
    need_login = if_controller(
        "If - 需要登录(L3+)",
        '${__jexl3("${__P(layer,1)}"!="1" && "${__P(layer,1)}"!="2",)}',
        [login_block()])

    hot = http("L1 GET 热销(纯缓存读)", "GET", "/api/products/hot",
               params=[("limit", "${hotLimit}", False)])
    hot.children = [json_assert("业务码=0")]
    l1 = if_controller("If - L1 纯缓存读", '${__jexl3("${__P(layer,1)}"=="1",)}', [hot])

    lst = http("L2 GET 商品列表(分页查库)", "GET", "/api/products", params=[
        ("page", "0", False), ("size", "${listSize}", False)])
    lst.children = [json_assert("业务码=0")]
    l2 = if_controller("If - L2 分页查库", '${__jexl3("${__P(layer,1)}"=="2",)}', [lst])

    l3 = if_controller("If - L3 下单(乐观锁写)", '${__jexl3("${__P(layer,1)}"=="3",)}',
                       order_pay_steps(include_cart=False, include_pay=False,
                                       include_poll=False, include_order_query=False))

    l4 = if_controller("If - L4 支付链路(同步)", '${__jexl3("${__P(layer,1)}"=="4",)}',
                       order_pay_steps(include_cart=False, include_pay=True,
                                       include_poll=False, include_order_query=True))

    l5 = if_controller("If - L5 支付链路(异步MQ)", '${__jexl3("${__P(layer,1)}"=="5",)}',
                       order_pay_steps(include_cart=False, include_pay=True,
                                       include_poll=True, include_order_query=True))

    l6 = if_controller("If - L6 全链路混合", '${__jexl3("${__P(layer,1)}"=="6",)}',
                       browse_steps() + order_pay_steps(include_cart=True, include_poll=True,
                                                        include_order_query=True))

    tg_layer = thread_group("TG-分层压测(layer=${__P(layer,1)})",
                            P("threads", 50), P("rampUp", 60), P("duration", 600), 0,
                            csv_block() + [
                                need_login,
                                AUTH_HEADER,
                                l1, l2, l3, l4, l5, l6,
                            ])
    plans["stress-layer.jmx"] = plan(
        "Shop Demo - 压力测试 分层压测 (L1-L6，用 -Jlayer 切换)",
        "L1 纯缓存读 / L2 分页查库 / L3 下单写 / L4 支付同步 / L5 支付异步MQ / L6 全链路。"
        "每层只让一个组件成为瓶颈，便于归因。",
        [tg_layer])

    os.makedirs(out_dir, exist_ok=True)
    for fname, tp in plans.items():
        body = "\n".join(tp.render(0))
        xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">\n'
               '  <hashTree>\n'
               + "\n".join("  " + l if l.strip() else l for l in body.split("\n"))
               + '\n  </hashTree>\n</jmeterTestPlan>\n')
        path = os.path.join(out_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(xml)
        print(f"  generated {fname} ({len(xml.splitlines())} 行)")
    return len(plans)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "plans"))
    a = ap.parse_args()
    print(f"输出目录: {os.path.abspath(a.out)}")
    n = build_all(os.path.abspath(a.out))
    print(f"共生成 {n} 个 plan")
