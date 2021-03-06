'use strict'

var chai = require('chai')
var expect = chai.expect
var should = chai.should()
var helper = require('../../lib/agent_helper')
var ErrorAggregator = require('../../../lib/errors/aggregator')
var Transaction = require('../../../lib/transaction')

var API = require('../../../api')
var DESTS = require('../../../lib/config/attribute-filter').DESTINATIONS
var NAMES = require('../../../lib/metrics/names')

function createTransaction(agent, code, isWeb) {
  if (typeof isWeb === 'undefined') isWeb = true

  var transaction = new Transaction(agent)
  if (isWeb) {
    transaction.type = Transaction.TYPES.WEB
    transaction.name = 'WebTransaction/TestJS/path'
    transaction.url = '/TestJS/path'
    transaction.statusCode = code
  } else {
    transaction.type = Transaction.TYPES.BG
    transaction.name = 'OtherTransaction'
  }
  return transaction
}

function createWebTransaction(agent, code) {
  return createTransaction(agent, code)
}

function createBackgroundTransaction(agent) {
  return createTransaction(agent, null, false)
}

describe('Errors', function() {
  var agent = null

  beforeEach(function() {
    agent = helper.loadMockedAgent(null, {
      attributes: {
        enabled: true
      }
    })
  })

  afterEach(function() {
    helper.unloadAgent(agent)
  })

  describe('agent attribute format', function() {
    var PARAMS = 4
    var trans = null
    var error = null

    beforeEach(function() {
      trans = new Transaction(agent)
      trans.url = '/'

      error = agent.errors
    })

    it('record captured params', function() {
      trans.trace.addAttribute(DESTS.ALL, 'request.parameters.a', 'A')
      error.add(trans, new Error())
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]
      expect(params.agentAttributes).deep.equals({'request.parameters.a': 'A'})

      // Error events
      params = error.getEvents()[0][2]
      expect(params).deep.equals({'request.parameters.a': 'A'})
    })

    it('records custom parameters', function() {
      trans.trace.addCustomAttribute('a', 'A')
      error.add(trans, new Error())
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]

      expect(params.userAttributes).deep.equals({a: 'A'})

      // error events
      params = error.getEvents()[0][1]

      expect(params).deep.equals({a: 'A'})
    })

    it('merge custom parameters', function() {
      trans.trace.addCustomAttribute('a', 'A')
      error.add(trans, new Error(), {b: 'B'})
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]

      expect(params.userAttributes).deep.equals({
        a: 'A',
        b: 'B'
      })

      // error events
      params = error.getEvents()[0][1]

      expect(params).deep.equals({
        a: 'A',
        b: 'B'
      })
    })

    it('overrides existing custom attributes with new custom attributes', function() {
      trans.trace.custom.a = 'A'
      error.add(trans, new Error(), {a: 'AA'})
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]

      expect(params.userAttributes).deep.equals({
        a: 'AA'
      })

      // error events
      params = error.getEvents()[0][1]

      expect(params).deep.equals({
        a: 'AA'
      })
    })

    it('does not add custom attributes in high security mode', function() {
      agent.config.high_security = true
      error.add(trans, new Error(), {a: 'AA'})
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]

      expect(params.userAttributes).deep.equals({})

      // error events
      params = error.getEvents()[0][1]

      expect(params).deep.equals({})
    })

    it('redacts the error message in high security mode', function() {
      agent.config.high_security = true
      error.add(trans, new Error('this should not be here'), {a: 'AA'})
      agent.errors.onTransactionFinished(trans, agent.metrics)

      expect(error.errors[0][2]).to.equal('')
      expect(error.errors[0][4].stack_trace[0]).to.equal('Error: <redacted>')
    })
    it('redacts the error message when strip_exception_messages.enabled', function() {
      agent.config.strip_exception_messages.enabled = true
      error.add(trans, new Error('this should not be here'), {a: 'AA'})
      agent.errors.onTransactionFinished(trans, agent.metrics)

      expect(error.errors[0][2]).to.equal('')
      expect(error.errors[0][4].stack_trace[0]).to.equal('Error: <redacted>')
    })
  })

  describe('display name', function() {
    var PARAMS = 4

    var trans, error

    it('should be in agent attributes if set by user', function() {
      agent.config.process_host.display_name = 'test-value'

      trans = new Transaction(agent)
      trans.url = '/'

      error = agent.errors
      error.add(trans, new Error())
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]
      expect(params.agentAttributes).deep.equals({
        'host.displayName': 'test-value'
      })
    })

    it('should not be in agent attributes if not set by user', function() {
      trans = new Transaction(agent)
      trans.url = '/'

      error = agent.errors
      error.add(trans, new Error())
      agent.errors.onTransactionFinished(trans, agent.metrics)

      var params = error.errors[0][PARAMS]
      expect(params.agentAttributes).deep.equals({})
    })
  })

  describe('ErrorAggregator', function() {
    var tracer

    beforeEach(function() {
      tracer = new ErrorAggregator(agent.config)
    })

    it('should preserve the name field on errors', function() {
      var api = new API(agent)

      var testError = new Error("EVERYTHING IS BROKEN")
      testError.name = "GAMEBREAKER"

      api.noticeError(testError)
      var error = agent.errors.errors[0]
      expect(error[error.length - 2]).equal(testError.name)
    })

    it('should not gather errors if it is switched off by user config', function() {
      var error = new Error('this error will never be seen')
      agent.config.error_collector.enabled = false

      expect(tracer.errorCount).equal(0)
      expect(tracer.errors.length).equal(0)

      tracer.add(null, error)

      expect(tracer.errorCount).equal(1)
      expect(tracer.errors.length).equal(0)

      agent.config.error_collector.enabled = true
    })

    it('should not gather errors if it is switched off by server config', function() {
      var error = new Error('this error will never be seen')
      agent.config.collect_errors = false

      expect(tracer.errorCount).equal(0)
      expect(tracer.errors.length).equal(0)

      tracer.add(null, error)

      expect(tracer.errorCount).equal(1)
      expect(tracer.errors.length).equal(0)

      agent.config.collect_errors = true
    })

    it('should gather the same error in two transactions', function(done) {
      var error = new Error('this happened once')
      var first = new Transaction(agent)
      var second = new Transaction(agent)

      expect(agent.errors.errorCount).equal(0)
      expect(agent.errors.errors.length).equal(0)

      agent.errors.add(first, error)
      expect(first.exceptions.length).equal(1)

      agent.errors.add(second, error)
      expect(second.exceptions.length).equal(1)

      first.end(function onEnd() {
        expect(agent.errors.errorCount).equal(1)

        second.end(function secondEnd() {
          expect(agent.errors.errorCount).equal(2)

          done()
        })
      })
    })

    it('should not gather the same error twice in the same transaction', function() {
      var error = new Error('this happened once')
      expect(tracer.errorCount).equal(0)
      expect(tracer.errors.length).equal(0)

      tracer.add(null, error)
      tracer.add(null, error)

      expect(tracer.errorCount).equal(1)
      expect(tracer.errors.length).equal(1)
    })

    it('should not break on read only objects', function() {
      var error = new Error('this happened once')
      Object.freeze(error)
      expect(tracer.errorCount).equal(0)
      expect(tracer.errors.length).equal(0)

      tracer.add(null, error)
      tracer.add(null, error)

      expect(tracer.errorCount).equal(1)
      expect(tracer.errors.length).equal(1)
    })

    it('should retain a maximum of 20 errors to send', function() {
      for (var i = 0; i < 5; i++) tracer.add(null, new Error('filling the queue'))
      expect(tracer.errors.length).equal(5)

      for (i = 0; i < 5; i++) tracer.add(null, new Error('more filling the queue'))
      expect(tracer.errors.length).equal(10)

      // this will take the tracer 3 over the limit of 20
      for (i = 0; i < 13; i++) tracer.add(null, new Error('overfilling the queue'))
      expect(tracer.errorCount).equal(23)
      expect(tracer.errors.length).equal(20)
    })

    describe('add()', function() {
      var aggregator

      beforeEach(function() {
        aggregator = agent.errors
      })

      describe('when handling immutable errors', function() {
        it('should not break', function() {
          var error = new Error()
          Object.freeze(error)
          aggregator.add(error)
        })
      })
    })

    describe('getErrors', function() {
      it('returns collected errors', function() {
        agent.errors.add(null, new Error('some error'))
        var errors = agent.errors.getErrors()
        expect(errors).length(1)
      })
    })

    describe('getEvents', function() {
      it('returns collected error events', function() {
        agent.errors.add(null, new Error('some error'))
        var events = agent.errors.getEvents()
        expect(events).length(1)
      })
    })

    describe('getEventsLimit', function() {
      it('returns the error events reservoir limit', function() {
        expect(agent.errors.getEventsLimit()).equal(agent.errors.events.limit)
      })
    })

    describe('getEventsSeen', function() {
      it('returns the number of error events that have been seen', function() {
        for (var i = 0; i < 200; i++) {
          agent.errors.add(null, new Error('error ' + i))
        }
        expect(agent.errors.getEventsSeen()).equal(200)
      })
    })

    describe('when finalizing transactions', function() {
      var tracer = null

      beforeEach(function() {
        tracer = agent.errors
      })

      it('should capture errors for transactions ending in error', function() {
        tracer.onTransactionFinished(createTransaction(agent, 400), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 500), agent.metrics)

        expect(tracer.errors.length).equal(2)
      })

      it('should count errors on the error tracer', function() {
        tracer.onTransactionFinished(createTransaction(agent, 400), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 500), agent.metrics)

        expect(tracer.errorCount).equal(2)
      })

      it('should count named errors on the agent metrics', function() {
        tracer.onTransactionFinished(createTransaction(agent, 400), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 500), agent.metrics)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(2)
      })

      it('should increment error metrics correctly', function() {
        var transaction = createTransaction(agent, 200)

        tracer.add(transaction, new Error('error1'))
        tracer.add(transaction, new Error('error2'))

        tracer.onTransactionFinished(transaction, agent.metrics)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(2)
      })

      it('should increment error metrics correctly with user errors', function() {
        var api = new API(agent)
        var transaction = createTransaction(agent, 200)

        agent.tracer.getTransaction = function() {
          return transaction
        }

        api.noticeError(new Error('error1'))
        api.noticeError(new Error('error2'))

        tracer.onTransactionFinished(transaction, agent.metrics)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(2)
      })

      it('should ignore errors if related transaction is ignored', function() {
        var transaction = createTransaction(agent, 500)
        transaction.ignore = true

        // add errors by various means
        tracer.add(transaction, new Error("no"))
        transaction.addException(new Error('ignored'))
        tracer.onTransactionFinished(transaction, agent.metrics)

        expect(tracer.errorCount).equal(0)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric).to.be.undefined
      })

      it('should ignore 404 errors for transactions', function() {
        tracer.onTransactionFinished(createTransaction(agent, 400), agent.metrics)
        // 404 errors are ignored by default
        tracer.onTransactionFinished(createTransaction(agent, 404), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 404), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 404), agent.metrics)
        tracer.onTransactionFinished(createTransaction(agent, 404), agent.metrics)

        expect(tracer.errorCount).equal(1)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(1)
      })

      it('should ignore 404 errors for transactions with exceptions attached', function() {
        var notIgnored = createTransaction(agent, 400)
        notIgnored.addException(new Error('bad request'))
        tracer.onTransactionFinished(notIgnored, agent.metrics)

        // 404 errors are ignored by default, but making sure the config is set
        tracer.config.error_collector.ignore_status_codes = [404]

        var ignored = createTransaction(agent, 404)
        ignored.addException(new Error('ignored'))
        tracer.onTransactionFinished(ignored, agent.metrics)

        expect(tracer.errorCount).equal(1)

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(1)
      })

      it('should collect exceptions added with noticeError() API even if the status ' +
          'code is in ignore_status_codes config', function() {
        var api = new API(agent)
        var tx = createTransaction(agent, 404)

        agent.tracer.getTransaction = function() {
          return tx
        }

        // 404 errors are ignored by default, but making sure the config is set
        tracer.config.error_collector.ignore_status_codes = [404]

        // this should be ignored
        tx.addException(new Error('should be ignored'))
        // this should go through
        api.noticeError(new Error('should go through'))
        tracer.onTransactionFinished(tx, agent.metrics)

        expect(tracer.errorCount).equal(1)
        var collectedErrors = tracer.errors
        expect(collectedErrors[0][2]).equal('should go through')

        var metric = agent.metrics.getMetric('Errors/WebTransaction/TestJS/path')
        expect(metric.callCount).equal(1)
      })
    })

    describe('with no exception and no transaction', function() {
      it('should have no errors', function() {
        agent.errors.add(null, null)
        expect(agent.errors.errors.length).equal(0)
      })
    })

    describe('with no error and a transaction with status code', function() {
      beforeEach(function() {
        agent.errors.add(new Transaction (agent), null)
      })

      it('should have no errors', function() {
        expect(agent.errors.errors.length).equal(0)
      })
    })

    describe('with no error and a transaction with a status code', function() {
      var tracer
      var errorJSON

      beforeEach(function() {
        tracer = agent.errors

        var transaction = new Transaction (agent)
        transaction.statusCode = 503 // PDX wut wut

        tracer.add(transaction, null)
        tracer.onTransactionFinished(transaction, agent.metrics)
        errorJSON = tracer.errors[0]
      })

      it('should have one error', function() {
        expect(tracer.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the default scope', function() {
        expect(errorJSON[1]).equal('Unknown')
      })

      it('should have an HTTP status code error message', function() {
        expect(errorJSON[2]).equal('HttpError 503')
      })

      it('should default to a type of Error', function() {
        expect(errorJSON[3]).equal('Error')
      })

      it('should not have a stack trace in the params', function() {
        var params = errorJSON[4]
        should.not.exist(params.stack_trace)
      })
    })

    describe('with transaction agent attrs, status code, and no error', function() {
      var errorJSON = null
      var params = null

      beforeEach(function() {
        var transaction = new Transaction(agent)
        transaction.statusCode = 501
        transaction.url = '/'
        transaction.trace.addAttributes(DESTS.ALL, {
          test_param: 'a value',
          thing: true
        })

        agent.errors.add(transaction, null)
        agent.errors.onTransactionFinished(transaction, agent.metrics)
        errorJSON = agent.errors.errors[0]
        params = errorJSON[4]
      })

      it('should have one error', function() {
        expect(agent.errors.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the URL\'s scope', function() {
        expect(errorJSON[1]).equal('WebTransaction/NormalizedUri/*')
      })

      it('should have an HTTP status code message', function() {
        expect(errorJSON[2]).equal('HttpError 501')
      })

      it('should default to  a type of Error', function() {
        expect(errorJSON[3]).equal('Error')
      })

      it('should not have a stack trace in the params', function() {
        should.not.exist(params.stack_trace)
      })

      it('should have a request URL', function() {
        expect(params['request.uri'] = '/test_action.json')
      })

      it('should parse out the first agent parameter', function() {
        expect(params.agentAttributes.test_param).equal('a value')
      })

      it('should parse out the other agent parameter', function() {
        expect(params.agentAttributes.thing).equal(true)
      })
    })

    it('with attributes.enabled disabled', function() {
      var transaction = new Transaction(agent)
      transaction.statusCode = 501

      transaction.url = '/test_action.json?test_param=a%20value&thing'

      agent.errors.add(transaction, null)
      agent.errors.onTransactionFinished(transaction, agent.metrics)

      var errorJSON = agent.errors.errors[0]
      var params = errorJSON[4]

      should.not.exist(params.request_params)
    })

    it('with attributes.enabled and attributes.exclude set', function() {
      agent.config.attributes.exclude = ['thing']
      agent.config.emit('attributes.exclude')

      var transaction = new Transaction(agent)
      transaction.statusCode = 501

      transaction.trace.addAttribute(DESTS.ALL, 'test_param', 'a value')
      transaction.trace.addAttribute(DESTS.ALL, 'thing', 5)

      agent.errors.add(transaction, null)
      agent._transactionFinished(transaction)

      var errorJSON = agent.errors.errors[0]
      var params = errorJSON[4]

      expect(params.agentAttributes).eql({test_param : 'a value'})
    })

    describe('with a thrown TypeError object and no transaction', function() {
      var tracer
      var errorJSON


      beforeEach(function() {
        tracer = agent.errors

        var exception = new Error('Dare to be the same!')

        tracer.add(null, exception)
        errorJSON = tracer.errors[0]
      })

      it('should have one error', function() {
        expect(tracer.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the default scope', function() {
        expect(errorJSON[1]).equal('Unknown')
      })

      it('should fish the message out of the exception', function() {
        expect(errorJSON[2]).equal('Dare to be the same!')
      })

      it('should have a type of TypeError', function() {
        expect(errorJSON[3]).equal('Error')
      })

      it('should have a stack trace in the params', function() {
        var params = errorJSON[4]
        should.exist(params.stack_trace)
        expect(params.stack_trace[0]).equal('Error: Dare to be the same!')
      })
    })

    describe('with a thrown TypeError object and a transaction with no parameters', function() {
      var tracer
      var errorJSON


      beforeEach(function() {
        tracer = agent.errors

        var transaction = new Transaction(agent)
        var exception = new TypeError('Dare to be different!')

        tracer.add(transaction, exception)
        tracer.onTransactionFinished(transaction, agent.metrics)
        errorJSON = tracer.errors[0]
      })

      it('should have one error', function() {
        expect(tracer.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the default scope', function() {
        expect(errorJSON[1]).equal('Unknown')
      })

      it('should fish the message out of the exception', function() {
        expect(errorJSON[2]).equal('Dare to be different!')
      })

      it('should have a type of TypeError', function() {
        expect(errorJSON[3]).equal('TypeError')
      })

      it('should have a stack trace in the params', function() {
        var params = errorJSON[4]
        should.exist(params.stack_trace)
        expect(params.stack_trace[0]).equal('TypeError: Dare to be different!')
      })
    })

    describe('with a thrown `TypeError` and a transaction with agent attrs', function() {
      var errorJSON = null
      var params = null

      beforeEach(function() {
        var transaction = new Transaction(agent)
        var exception = new TypeError('wanted JSON, got XML')

        transaction.trace.addAttributes(DESTS.ALL, {
          test_param: 'a value',
          thing: true
        })
        transaction.url = '/test_action.json'

        agent.errors.add(transaction, exception)
        agent.errors.onTransactionFinished(transaction, agent.metrics)
        errorJSON = agent.errors.errors[0]
        params = errorJSON[4]
      })

      it('should have one error', function() {
        expect(agent.errors.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the URL\'s scope', function() {
        expect(errorJSON[1]).equal('WebTransaction/NormalizedUri/*')
      })

      it('should fish the message out of the exception', function() {
        expect(errorJSON[2]).equal('wanted JSON, got XML')
      })

      it('should have a type of TypeError', function() {
        expect(errorJSON[3]).equal('TypeError')
      })

      it('should have a stack trace in the params', function() {
        should.exist(params.stack_trace)
        expect(params.stack_trace[0]).equal('TypeError: wanted JSON, got XML')
      })

      it('should have a request URL', function() {
        expect(params['request.uri'] = '/test_action.json')
      })

      it('should parse out the first agent parameter', function() {
        expect(params.agentAttributes.test_param).equal('a value')
      })

      it('should parse out the other agent parameter', function() {
        expect(params.agentAttributes.thing).equal(true)
      })
    })

    describe('with a thrown string and a transaction', function() {
      var tracer
      var errorJSON


      beforeEach(function() {
        tracer = agent.errors

        var transaction = new Transaction(agent)
        var exception = 'Dare to be different!'

        tracer.add(transaction, exception)
        tracer.onTransactionFinished(transaction, agent.metrics)
        errorJSON = tracer.errors[0]
      })

      it('should have one error', function() {
        expect(tracer.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the default scope', function() {
        expect(errorJSON[1]).equal('Unknown')
      })

      it('should turn the string into the message', function() {
        expect(errorJSON[2]).equal('Dare to be different!')
      })

      it('should default to a type of Error', function() {
        expect(errorJSON[3]).equal('Error')
      })

      it('should have no stack trace', function() {
        should.not.exist(errorJSON[4].stack_trace)
      })
    })

    describe('with a thrown string and a transaction with agent parameters', function() {
      var errorJSON = null
      var params = null

      beforeEach(function() {
        var transaction = new Transaction(agent)
        var exception = 'wanted JSON, got XML'

        transaction.trace.addAttributes(DESTS.ALL, {
          test_param: 'a value',
          thing: true
        })

        transaction.url = '/test_action.json'

        agent.errors.add(transaction, exception)
        agent.errors.onTransactionFinished(transaction, agent.metrics)
        errorJSON = agent.errors.errors[0]
        params = errorJSON[4]
      })

      it('should have one error', function() {
        expect(agent.errors.errors.length).equal(1)
      })

      it('should not care what time it was traced', function() {
        expect(errorJSON[0]).equal(0)
      })

      it('should have the transaction\'s name', function() {
        expect(errorJSON[1]).equal('WebTransaction/NormalizedUri/*')
      })

      it('should turn the string into the message', function() {
        expect(errorJSON[2]).equal('wanted JSON, got XML')
      })

      it('should default to a type of Error', function() {
        expect(errorJSON[3]).equal('Error')
      })

      it('should not have a stack trace in the params', function() {
        should.not.exist(params.stack_trace)
      })

      it('should have a request URL', function() {
        expect(params['request.uri'] = '/test_action.json')
      })

      it('should parse out the first agent parameter', function() {
        expect(params.agentAttributes.test_param).equal('a value')
      })

      it('should parse out the other agent parameter', function() {
        expect(params.agentAttributes.thing).equal(true)
      })
    })

    describe('with an internal server error (500) and an exception', function() {
      var name = 'WebTransaction/Uri/test-request/zxrkbl'
      var error


      beforeEach(function(done) {
        tracer = agent.errors

        var transaction = new Transaction(agent)
        var exception = new Error('500 test error')

        transaction.addException(exception)
        transaction.url = '/test-request/zxrkbl'
        transaction.name = 'WebTransaction/Uri/test-request/zxrkbl'
        transaction.statusCode = 500
        transaction.end(function() {
          error = tracer.errors[0]
          done()
        })
      })

      it('should associate errors with the transaction\'s name', function() {
        var errorName = error[1]

        expect(errorName).equal(name)
      })

      it('should associate errors with a message', function() {
        var message = error[2]

        expect(message).match(/500 test error/)
      })

      it('should associate errors with a message class', function() {
        var messageClass = error[3]

        expect(messageClass).equal('Error')
      })

      it('should associate errors with parameters', function() {
        var params = error[4]

        should.exist(params)
        should.exist(params.stack_trace)
        expect(params.stack_trace[0]).equal('Error: 500 test error')
      })
    })

    describe('with a tracer unavailable (503) error', function() {
      var name = 'WebTransaction/Uri/test-request/zxrkbl'
      var error

      beforeEach(function(done) {
        tracer = agent.errors

        var transaction = new Transaction(agent)
        transaction.url = '/test-request/zxrkbl'
        transaction.name = 'WebTransaction/Uri/test-request/zxrkbl'
        transaction.statusCode = 503
        transaction.end(function() {
          error = tracer.errors[0]
          done()
        })
      })

      it('should associate errors with the transaction\'s name', function() {
        var errorName = error[1]
        expect(errorName).equal(name)
      })

      it('should associate errors with a message', function() {
        var message = error[2]
        expect(message).equal('HttpError 503')
      })
      it('should associate errors with an error type', function() {
        var messageClass = error[3]
        expect(messageClass).equal('Error')
      })
    })

    describe('when merging from failed collector delivery', function() {
      it('should not crash on null errors', function() {
        expect(function() { tracer.merge(null) }).not.throws()
      })

      it('should never merge more than 20 errors', function() {
        var sample = [0, 'Unknown', 'something bad happened', 'Error', {}]
        var errors = []
        for (var i = 0; i < 30; i++) errors.push(sample)

        tracer.merge(errors)

        expect(tracer.errors.length).equal(20)
      })
    })

    describe('when using the async listener', function() {
      var mochaHandlers
      var transaction
      var active
      var json

      beforeEach(function(done) {
        helper.unloadAgent(agent)
        agent = helper.instrumentMockedAgent()

        /**
         * Mocha is extremely zealous about trapping errors, and runs each test
         * in a try / catch block. To get the exception to propagate out to the
         * domain's uncaughtException handler, we need to put the test in an
         * asynchronous context and break out of the mocha jail.
         */
        process.nextTick(function cb_nextTick() {
          // disable mocha's error handler
          mochaHandlers = helper.onlyDomains()

          process.once('uncaughtException', function() {
            json = agent.errors.errors[0]

            return done()
          })

          var disruptor = agent.tracer.transactionProxy(function cb_transactionProxy() {
            transaction = agent.getTransaction()
            active = process.domain

            // trigger the error handler
            throw new Error('sample error')
          })

          disruptor()
        })
      })

      afterEach(function() {
        // ...but be sure to re-enable mocha's error handler
        transaction.end()
        process._events.uncaughtException = mochaHandlers
      })

      it('should not have a domain active', function() {
        should.not.exist(active)
      })

      it('should find a single error', function() {
        expect(agent.errors.errors.length).equal(1)
      })

      describe('and an error is traced', function() {
        it('should find the error', function() {
          should.exist(json)
        })

        it('should have 5 elements in the trace', function() {
          expect(json.length).equal(5)
        })

        it('should have the default name', function() {
          expect(json[1]).equal('Unknown')
        })

        it('should have the error\'s message', function() {
          expect(json[2]).equal('sample error')
        })

        it('should have the error\'s constructor name (type)', function() {
          expect(json[3]).equal('Error')
        })

        it('should default to passing the stack trace as a parameter', function() {
          var params = json[4]

          should.exist(params)
          should.exist(params.stack_trace)
          expect(params.stack_trace[0]).equal('Error: sample error')
        })
      })
    })

    it('should allow throwing null', function() {
      var api = new API(agent)

      try {
        api.startBackgroundTransaction('job', function() {
          throw null
        })
      } catch (err) {
        expect(err).equal(null)
      }
    })

    it('should copy parameters from background transactions', function(done) {
      var errorTracer = agent.errors
      var api = new API(agent)

      api.startBackgroundTransaction('job', function() {
        api.addCustomParameter('jobType', 'timer')
        api.noticeError(new Error('record an error'))
        agent.getTransaction().end(function() {
          expect(errorTracer.errors.length).equal(1)
          expect(errorTracer.errors[0][2]).equal('record an error')
          done()
        })
      })
    })

    describe('getTotalErrorCount()', function() {
      var aggregator

      beforeEach(function() {
        aggregator = agent.errors
      })

      describe('returns total of all collected errors', function() {
        it('without transaction', function() {
          aggregator.add(null, new Error('error1'))
          expect(aggregator.getTotalErrorCount()).equal(1)
        })

        it('with web transaction', function(done) {
          var transaction = createWebTransaction(agent)
          expect(transaction.isWeb()).to.be.true
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getTotalErrorCount()).equal(1)
            done()
          })
        })

        it('with background transaction', function(done) {
          var transaction = createBackgroundTransaction(agent)
          expect(transaction.isWeb()).to.be.false
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getTotalErrorCount()).equal(1)
            done()
          })
        })
      })
    })

    describe('getWebTransactionsErrorCount()', function() {
      var aggregator

      beforeEach(function() {
        aggregator = agent.errors
      })

      describe('returns total of web transactions errors', function() {
        it('without transaction', function() {
          aggregator.add(null, new Error('error1'))
          expect(aggregator.getWebTransactionsErrorCount()).equal(0)
        })

        it('with web transaction', function(done) {
          var transaction = createWebTransaction(agent)
          expect(transaction.isWeb()).to.be.true
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getWebTransactionsErrorCount()).equal(1)
            done()
          })
        })

        it('with background transaction', function(done) {
          var transaction = createBackgroundTransaction(agent)
          expect(transaction.isWeb()).to.be.false
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getWebTransactionsErrorCount()).equal(0)
            done()
          })
        })
      })
    })

    describe('getBackgroundTransactionsErrorCount()', function() {
      var aggregator

      beforeEach(function() {
        aggregator = agent.errors
      })

      describe('returns total of background transactions errors', function() {
        it('without transaction', function() {
          aggregator.add(null, new Error('error1'))
          expect(aggregator.getBackgroundTransactionsErrorCount()).equal(0)
        })

        it('with web transaction', function(done) {
          var transaction = createWebTransaction(agent)
          expect(transaction.isWeb()).to.be.true
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getBackgroundTransactionsErrorCount()).equal(0)
            done()
          })
        })

        it('with background transaction', function(done) {
          var transaction = createBackgroundTransaction(agent)
          expect(transaction.isWeb()).to.be.false
          aggregator.add(transaction, new Error('error1'))

          transaction.end(function() {
            expect(aggregator.getBackgroundTransactionsErrorCount()).equal(1)
            done()
          })
        })
      })
    })

    describe('clearErrors()', function() {
      var aggregator

      beforeEach(function() {
        aggregator = agent.errors
      })

      it('clears collected errors', function() {
        aggregator.add(null, new Error('error1'))
        expect(aggregator.getErrors()).length(1)
        aggregator.clearErrors()
        expect(aggregator.getErrors()).length(0)
      })

      it('clears total error count', function() {
        aggregator.add(null, new Error('error1'))
        expect(aggregator.getTotalErrorCount()).equal(1)
        aggregator.clearErrors()
        expect(aggregator.getTotalErrorCount()).equal(0)
      })

      it('clears web tx error count', function(done) {
        var transaction = createWebTransaction(agent)
        aggregator.add(transaction, new Error('error1'))

        transaction.end(function() {
          expect(aggregator.getWebTransactionsErrorCount()).equal(1)
          aggregator.clearErrors()
          expect(aggregator.getWebTransactionsErrorCount()).equal(0)
          done()
        })
      })

      it('clears background tx error count', function(done) {
        var transaction = createBackgroundTransaction(agent)
        aggregator.add(transaction, new Error('error1'))

        transaction.end(function() {
          expect(aggregator.getBackgroundTransactionsErrorCount()).equal(1)
          aggregator.clearErrors()
          expect(aggregator.getBackgroundTransactionsErrorCount()).equal(0)
          done()
        })
      })
    })
  })

  describe('traced errors', function() {
    var aggregator

    beforeEach(function() {
      aggregator = agent.errors
    })

    describe('without transaction', function() {
      it('should contain no intrinsic attributes', function() {
        var error = new Error('some error')
        aggregator.add(null, error)

        expect(aggregator.errors).length(1)

        var attributes = getFirstErrorIntrinsicAttributes(aggregator)
        expect(attributes).to.be.a('Object')
      })

      it('should contain supplied custom attributes, with filter rules', function() {
        agent.config.error_collector.attributes.exclude.push('c')
        agent.config.emit('error_collector.attributes.exclude')
        var error = new Error('some error')
        var customAttributes = { a: 'b', c: 'ignored' }
        aggregator.add(null, error, customAttributes)

        var attributes = getFirstErrorCustomAttributes(aggregator)
        expect(attributes.a).equal('b')
        expect(attributes.c).to.be.undefined
      })
    })

    describe('on transaction finished', function() {
      it('should generate an event if the transaction is an HTTP error', function(done) {
        var transaction = createTransaction(agent, 500)
        aggregator.add(transaction)

        transaction.end(function() {
          var collectedError = aggregator.errors[0]
          should.exist(collectedError)
          done()
        })
      })

      it('should contain CAT intrinsic parameters', function(done) {
        var transaction = createTransaction(agent, 200)

        transaction.referringTransactionGuid = '1234'
        transaction.incomingCatId = '2345'

        var error = new Error('some error')
        aggregator.add(transaction, error)

        transaction.end(function() {
          var attributes = getFirstErrorIntrinsicAttributes(aggregator)

          expect(attributes).to.be.a('Object')
          expect(attributes.path_hash).to.be.a('string')
          expect(attributes.referring_transaction_guid).equal('1234')
          expect(attributes.client_cross_process_id).equal('2345')
          done()
        })
      })

      it('should contain Synthetics intrinsic parameters', function(done) {
        var transaction = createTransaction(agent, 200)

        transaction.syntheticsData = {
          version: 1,
          accountId: 123,
          resourceId: 'resId',
          jobId: 'jobId',
          monitorId: 'monId'
        }

        var error = new Error('some error')
        aggregator.add(transaction, error)

        transaction.end(function() {
          var attributes = getFirstErrorIntrinsicAttributes(aggregator)

          expect(attributes).to.be.a('Object')
          expect(attributes.synthetics_resource_id).equal('resId')
          expect(attributes.synthetics_job_id).equal('jobId')
          expect(attributes.synthetics_monitor_id).equal('monId')
          done()
        })
      })

      it('should contain custom parameters', function(done) {
        var transaction = createTransaction(agent, 500)
        var error = new Error('some error')
        var customParameters = { a: 'b' }
        aggregator.add(transaction, error, customParameters)

        transaction.end(function() {
          var attributes = getFirstErrorCustomAttributes(aggregator)
          expect(attributes.a).equal('b')
          done()
        })
      })

      it('should merge supplied custom parameters with custom parameters on the trace', function(done) {
        agent.config.attributes.enabled = true
        var transaction = createTransaction(agent, 500)
        transaction.trace.addCustomAttribute('a', 'b')
        var error = new Error('some error')

        var customParameters = { c: 'd' }
        aggregator.add(transaction, error, customParameters)

        transaction.end(function() {
          var attributes = getFirstErrorCustomAttributes(aggregator)
          expect(attributes.a).equal('b')
          expect(attributes.c).equal('d')
          done()
        })
      })
    })
  })

  describe('error events', function() {
    var aggregator

    beforeEach(function() {
      aggregator = agent.errors
    })

    it('should not gather error events if switched off by user config', function(done) {
      agent.collector.errorEvents = function() {
        throw new Error()
      }
      agent.config.error_collector.capture_events = false
      agent._sendErrorEvents(function() {
        done()
      })
    })

    it('should not gather error events if switched off by server config', function(done) {
      agent.config.error_collector.capture_events = true
      agent.collector.errorEvents = function() {
        throw new Error()
      }
      agent._sendErrorEvents(function() {
        done()
      })
    })

    it('should omit the error message when in high security mode', function() {
      agent.config.high_security = true
      agent.errors.add(null, new Error('some error'))
      var events = agent.errors.getEvents()
      expect(events[0][0]['error.message']).to.equal('')
      agent.config.high_security = false
    })

    it('not spill over reservoir size', function() {
      if (agent) helper.unloadAgent(agent)
      agent = helper.loadMockedAgent(null,
        { error_collector: { max_event_samples_stored: 10 } })

      for (var i = 0; i < 20; i++) {
        agent.errors.add(null, new Error('some error'))
      }

      var events = agent.errors.getEvents()
      expect(events).length(10)
    })

    it('re-aggregate on failure', function(done) {
      agent.collector.isConnected = function() { return true }
      agent.collector.metricData = function(payload, cb) { cb() }
      agent.collector.errorEvents = function(payload, cb) { cb(true) }

      for (var i = 0; i < 20; i++) {
        agent.errors.add(null, new Error('some error'))
      }

      agent._sendErrorEvents(function() {})

      agent._sendMetrics(function() {
        agent._sendErrorEvents(function(err) {
          expect(err).exist
          expect(agent.errors.getEvents()).length(20)
          done()
        })
      })
    })

    it('empty on success', function(done) {
      agent.collector.isConnected = function() { return true }
      agent.collector.metricData = function(payload, cb) { cb() }
      agent.collector.errorEvents = function(payload, cb) { cb() }

      for (var i = 0; i < 20; i++) {
        agent.errors.add(null, new Error('some error'))
      }

      agent._sendMetrics(function() {
        agent._sendErrorEvents(function() {
          expect(agent.errors.getEvents()).length(0)
          done()
        })
      })
    })

    it('empty on 413', function(done) {
      agent.collector.isConnected = function() { return true }
      agent.collector.metricData = function(payload, cb) { cb() }
      agent.collector.errorEvents = function(payload, cb) { cb({ statusCode: 413 }) }

      for (var i = 0; i < 20; i++) {
        agent.errors.add(null, new Error('some error'))
      }

      agent._sendMetrics(function() {
        agent._sendErrorEvents(function(err) {
          expect(err).exist
          expect(agent.errors.getEvents()).length(0)
          done()
        })
      })
    })

    describe('without transaction', function() {
      describe('using add()', function() {
        it('should contain intrinsic attributes', function() {
          var error = new Error('some error')
          var nowSeconds = Date.now() / 1000
          aggregator.add(null, error)

          expect(aggregator.errors).length(1)

          var attributes = getFirstEventIntrinsicAttributes(aggregator)
          expect(attributes).to.be.a('Object')
          expect(attributes.type).equal('TransactionError')
          expect(attributes['error.class']).to.be.a('string')
          expect(attributes['error.message']).to.be.a('string')
          expect(attributes.timestamp).closeTo(nowSeconds, 1)
          expect(attributes.transactionName).equal('Unknown')
        })

        it('should set transactionName to Unknown', function() {
          var error = new Error('some error')
          aggregator.add(null, error)

          var attributes = getFirstEventIntrinsicAttributes(aggregator)
          expect(attributes.transactionName).equal('Unknown')
        })

        it('should contain supplied custom attributes, with filter rules', function() {
          agent.config.attributes.enabled = true
          agent.config.attributes.exclude.push('c')
          agent.config.emit('attributes.exclude')
          var error = new Error('some error')
          var customAttributes = { a: 'b', c: 'ignored' }
          aggregator.add(null, error, customAttributes)

          var attributes = getFirstEventCustomAttributes(aggregator)
          expect(Object.keys(attributes)).length(1)
          expect(attributes.a).equal('b')
          expect(attributes.c).to.be.undefined
        })

        it('should contain agent attributes', function() {
          agent.config.attributes.enabled = true
          var error = new Error('some error')
          aggregator.add(null, error, { a: 'a' })

          var agentAttributes = getFirstEventAgentAttributes(aggregator)
          var customAttributes = getFirstEventCustomAttributes(aggregator)

          expect(Object.keys(customAttributes)).length(1)
          expect(Object.keys(agentAttributes)).length(0)
        })
      })

      describe('using noticeError() API', function() {
        var api

        beforeEach(function() {
          api = new API(agent)
        })

        it('should contain intrinsic parameters', function() {
          var error = new Error('some error')
          var nowSeconds = Date.now() / 1000
          api.noticeError(error)

          expect(aggregator.errors).length(1)

          var attributes = getFirstEventIntrinsicAttributes(aggregator)
          expect(attributes).to.be.a('Object')
          expect(attributes.type).equal('TransactionError')
          expect(attributes['error.class']).to.be.a('string')
          expect(attributes['error.message']).to.be.a('string')
          expect(attributes.timestamp).closeTo(nowSeconds, 1)
          expect(attributes.transactionName).equal('Unknown')
        })

        it('should set transactionName to Unknown', function() {
          var error = new Error('some error')
          api.noticeError(error)

          var attributes = getFirstEventIntrinsicAttributes(aggregator)
          expect(attributes.transactionName).equal('Unknown')
        })

        it('should contain expected attributes, with filter rules', function() {
          agent.config.attributes.enabled = true
          agent.config.attributes.exclude = ['c']
          agent.config.emit('attributes.exclude')
          var error = new Error('some error')
          var customAttributes = { a: 'b', c: 'ignored' }
          api.noticeError(error, customAttributes)

          var agentAttributes = getFirstEventAgentAttributes(aggregator)
          var customAttributes = getFirstEventCustomAttributes(aggregator)

          expect(Object.keys(customAttributes)).length(1)
          expect(customAttributes.c).to.be.undefined
          expect(Object.keys(agentAttributes)).length(0)
        })
      })
    })

    describe('on transaction finished', function() {
      it('should generate an event if the transaction is an HTTP error', function(done) {
        var transaction = createTransaction(agent, 500)
        aggregator.add(transaction)

        transaction.end(function() {
          var collectedError = aggregator.errors[0]
          should.exist(collectedError)
          done()
        })
      })

      it('should contain required intrinsic attributes', function(done) {
        var transaction = createTransaction(agent, 200)

        var error = new Error('some error')
        var nowSeconds = Date.now() / 1000
        aggregator.add(transaction, error)

        transaction.end(function() {
          var attributes = getFirstEventIntrinsicAttributes(aggregator)

          expect(attributes).to.be.a('Object')
          expect(attributes.type).equal('TransactionError')
          expect(attributes['error.class']).to.be.a('string')
          expect(attributes['error.message']).to.be.a('string')
          expect(attributes.timestamp).closeTo(nowSeconds, 1)
          expect(attributes.transactionName).equal(transaction.name)
          done()
        })
      })

      describe('transaction-specific intrinsic attributes if part of transaction', function() {
        var transaction
        var error

        beforeEach(function() {
          transaction = createTransaction(agent, 500)
          error = new Error('some error')
          aggregator.add(transaction, error)
        })

        it('includes transaction duration', function(done) {
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.duration)
              .to.equal(transaction.timer.getDurationInMillis() / 1000)
            done()
          })
        })

        it('includes queueDuration if available', function(done) {
          transaction.measure(NAMES.QUEUETIME, null, 100)
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.queueDuration).equal(0.1)
            done()
          })
        })

        it('includes externalDuration if available', function(done) {
          transaction.measure(NAMES.EXTERNAL.ALL, null, 100)
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.externalDuration).equal(0.1)
            done()
          })
        })

        it('includes databaseDuration if available', function(done) {
          transaction.measure(NAMES.DB.ALL, null, 100)
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.databaseDuration).equal(0.1)
            done()
          })
        })

        it('includes externalCallCount if available', function(done) {
          transaction.measure(NAMES.EXTERNAL.ALL, null, 100)
          transaction.measure(NAMES.EXTERNAL.ALL, null, 100)
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.externalCallCount).equal(2)
            done()
          })
        })

        it('includes databaseCallCount if available', function(done) {
          transaction.measure(NAMES.DB.ALL, null, 100)
          transaction.measure(NAMES.DB.ALL, null, 100)
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes.databaseCallCount).equal(2)
            done()
          })
        })

        it('includes internal synthetics attributes', function(done) {
          transaction.syntheticsData = {
            version: 1,
            accountId: 123,
            resourceId: 'resId',
            jobId: 'jobId',
            monitorId: 'monId'
          }
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes['nr.syntheticsResourceId']).equal('resId')
            expect(attributes['nr.syntheticsJobId']).equal('jobId')
            expect(attributes['nr.syntheticsMonitorId']).equal('monId')
            done()
          })
        })

        it('includes internal transactionGuid attribute', function(done) {
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes['nr.transactionGuid']).equal(transaction.id)
            done()
          })
        })

        it('includes internal referringTransactionGuid attribute', function(done) {
          transaction.referringTransactionGuid = '1234'
          transaction.end(function() {
            var attributes = getFirstEventIntrinsicAttributes(aggregator)
            expect(attributes['nr.referringTransactionGuid'])
              .to.equal(transaction.referringTransactionGuid)
            done()
          })
        })

        it('includes http port if the transaction is a web transaction', function(done) {
          var http = require('http')

          helper.unloadAgent(agent)
          agent = helper.instrumentMockedAgent()

          var server = http.createServer(function cb_createServer(req, res) {
            should.exist(agent.getTransaction())
            // Return HTTP error, so that when the transaction ends, an error
            // event is generated.
            res.statusCode = 500
            res.end()
          })

          server.listen(0, 'localhost', function() {
            var port = server.address().port
            http.get({ port: port, host: 'localhost' })
          })

          agent.on('transactionFinished', function(tx) {
            process.nextTick(function() {
              var attributes = getFirstEventIntrinsicAttributes(agent.errors)
              expect(attributes.port).equal(tx.port)
              done()
            })
          })
        })
      })

      it('should contain custom attributes, with filter rules', function(done) {
        agent.config.attributes.exclude.push('c')
        agent.config.emit('attributes.exclude')
        var transaction = createTransaction(agent, 500)
        var error = new Error('some error')
        var customAttributes = { a: 'b', c: 'ignored' }
        aggregator.add(transaction, error, customAttributes)

        transaction.end(function() {
          var attributes = getFirstEventCustomAttributes(aggregator)
          expect(attributes.a).equal('b')
          expect(attributes.c).to.be.undefined
          done()
        })
      })

      it('should merge new custom attrs with trace custom attrs', function(done) {
        var transaction = createTransaction(agent, 500)
        transaction.trace.addCustomAttribute('a', 'b')
        var error = new Error('some error')

        var customAttributes = { c: 'd' }
        aggregator.add(transaction, error, customAttributes)

        transaction.end(function() {
          var attributes = getFirstEventCustomAttributes(aggregator)
          expect(Object.keys(attributes)).length(2)
          expect(attributes.a).equal('b')
          expect(attributes.c).equal('d')
          done()
        })
      })

      it('should contain agent attributes', function() {
        agent.config.attributes.enabled = true
        var transaction = createTransaction(agent, 500)
        transaction.trace.addAttribute(DESTS.ALL, 'host.displayName', 'myHost')
        var error = new Error('some error')
        aggregator.add(transaction, error, { a: 'a' })

        transaction.end(function() {
          var agentAttributes = getFirstEventAgentAttributes(aggregator)
          var customAttributes = getFirstEventCustomAttributes(aggregator)

          expect(Object.keys(customAttributes)).length(1)
          expect(customAttributes.a).equal('a')
          expect(Object.keys(agentAttributes)).length(1)
          expect(agentAttributes['host.displayName']).equal('myHost')
        })
      })
    })
  })
})

function getFirstErrorIntrinsicAttributes(aggregator) {
  return getFirstError(aggregator)[4].intrinsics
}

function getFirstErrorCustomAttributes(aggregator) {
  return getFirstError(aggregator)[4].userAttributes
}

function getFirstError(aggregator) {
  var errors = aggregator.errors
  expect(errors.length).equal(1)
  return errors[0]
}

function getFirstEventIntrinsicAttributes(aggregator) {
  return getFirstEvent(aggregator)[0]
}

function getFirstEventCustomAttributes(aggregator) {
  return getFirstEvent(aggregator)[1]
}

function getFirstEventAgentAttributes(aggregator) {
  return getFirstEvent(aggregator)[2]
}

function getFirstEvent(aggregator) {
  var events = aggregator.getEvents()
  expect(events.length).equal(1)
  return events[0]
}
