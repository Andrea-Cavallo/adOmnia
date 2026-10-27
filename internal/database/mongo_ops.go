package database

import (
	"context"
	jsonv1 "encoding/json"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// mongoOpCtx carries everything a single MongoDB operation handler needs.
type mongoOpCtx struct {
	ctx            context.Context
	client         *mongo.Client
	db             *mongo.Database
	cmd            mongoQueryCommand
	op             string
	collectionName string
	limit          int64
	resp           *dbQueryResponse
}

func (o *mongoOpCtx) collection() (*mongo.Collection, error) {
	if o.collectionName == "" {
		return nil, fmt.Errorf("MongoDB operation %q requires collection", o.op)
	}
	return o.db.Collection(o.collectionName), nil
}

// filterDoc parses cmd.Filter, defaulting to an empty document.
func (o *mongoOpCtx) filterDoc() (any, error) {
	filter, err := mongoRawDoc(o.cmd.Filter, bson.D{})
	if err != nil {
		return nil, fmt.Errorf("invalid filter: %w", err)
	}
	return filter, nil
}

func (o *mongoOpCtx) setCount(count int64) {
	o.resp.Columns = []string{"count"}
	o.resp.Rows = []map[string]any{{"count": count}}
}

func (o *mongoOpCtx) setNames(column string, names []string) {
	o.resp.Columns = []string{column}
	o.resp.Rows = make([]map[string]any, 0, len(names))
	for _, name := range names {
		o.resp.Rows = append(o.resp.Rows, map[string]any{column: name})
	}
}

func (o *mongoOpCtx) setUpdateResult(r *mongo.UpdateResult) {
	o.resp.RowsAffected = r.ModifiedCount
	o.resp.Columns = []string{"matched", "modified", "upsertedId"}
	o.resp.Rows = []map[string]any{{"matched": r.MatchedCount, "modified": r.ModifiedCount, "upsertedId": mongoValue(r.UpsertedID)}}
}

type mongoOpHandler func(*mongoOpCtx) error

var mongoOpHandlers = map[string]mongoOpHandler{
	"find":             mongoOpFind,
	"aggregate":        mongoOpAggregate,
	"insertone":        mongoOpInsertOne,
	"insertmany":       mongoOpInsertMany,
	"updateone":        mongoOpUpdate,
	"updatemany":       mongoOpUpdate,
	"replaceone":       mongoOpReplaceOne,
	"deleteone":        mongoOpDelete,
	"deletemany":       mongoOpDelete,
	"count":            mongoOpCount,
	"countdocuments":   mongoOpCount,
	"estimatedcount":   mongoOpEstimatedCount,
	"listcollections":  mongoOpListCollections,
	"listdatabases":    mongoOpListDatabases,
	"createcollection": mongoOpCreateCollection,
	"dropcollection":   mongoOpDropCollection,
	"dropdatabase":     mongoOpDropDatabase,
	"runcommand":       mongoOpRunCommand,
}

// mongoFindOptions builds the find options from the command.
func mongoFindOptions(cmd mongoQueryCommand, limit int64) (*options.FindOptionsBuilder, error) {
	findOpts := options.Find().SetLimit(limit)
	if cmd.Skip > 0 {
		findOpts.SetSkip(cmd.Skip)
	}
	if len(cmd.Projection) > 0 {
		projection, err := mongoRawDoc(cmd.Projection, nil)
		if err != nil {
			return nil, fmt.Errorf("invalid projection: %w", err)
		}
		findOpts.SetProjection(projection)
	}
	if len(cmd.Sort) > 0 {
		sortDoc, err := mongoRawDoc(cmd.Sort, nil)
		if err != nil {
			return nil, fmt.Errorf("invalid sort: %w", err)
		}
		findOpts.SetSort(sortDoc)
	}
	return findOpts, nil
}

func mongoOpFind(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	filter, err := o.filterDoc()
	if err != nil {
		return err
	}
	findOpts, err := mongoFindOptions(o.cmd, o.limit)
	if err != nil {
		return err
	}
	cursor, err := coll.Find(o.ctx, filter, findOpts)
	if err != nil {
		return err
	}
	if err := fillMongoResult(o.ctx, cursor, o.cmd.Canonical, o.resp); err != nil {
		return err
	}
	o.resp.Limited = true
	return nil
}

func mongoOpAggregate(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	pipeline, err := mongoRawPipeline(o.cmd.Pipeline)
	if err != nil {
		return err
	}
	cursor, err := coll.Aggregate(o.ctx, pipeline)
	if err != nil {
		return err
	}
	return fillMongoResult(o.ctx, cursor, o.cmd.Canonical, o.resp)
}

func mongoOpInsertOne(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	doc, err := mongoRawDoc(o.cmd.Document, nil)
	if err != nil {
		return fmt.Errorf("invalid document: %w", err)
	}
	result, err := coll.InsertOne(o.ctx, doc)
	if err != nil {
		return err
	}
	o.resp.RowsAffected = 1
	o.resp.Columns = []string{"insertedId"}
	o.resp.Rows = []map[string]any{{"insertedId": mongoValue(result.InsertedID)}}
	return nil
}

func mongoOpInsertMany(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	docs, err := mongoRawDocuments(o.cmd.Documents)
	if err != nil {
		return err
	}
	result, err := coll.InsertMany(o.ctx, docs)
	if err != nil {
		return err
	}
	o.resp.RowsAffected = int64(len(result.InsertedIDs))
	o.resp.Columns = []string{"insertedIds"}
	o.resp.Rows = []map[string]any{{"insertedIds": mongoValue(result.InsertedIDs)}}
	return nil
}

func mongoOpUpdate(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	filter, err := o.filterDoc()
	if err != nil {
		return err
	}
	update, err := mongoRawDoc(o.cmd.Update, nil)
	if err != nil {
		return fmt.Errorf("invalid update: %w", err)
	}
	var result *mongo.UpdateResult
	if o.op == "updateone" {
		result, err = coll.UpdateOne(o.ctx, filter, update, options.UpdateOne().SetUpsert(o.cmd.Upsert))
	} else {
		result, err = coll.UpdateMany(o.ctx, filter, update, options.UpdateMany().SetUpsert(o.cmd.Upsert))
	}
	if err != nil {
		return err
	}
	o.setUpdateResult(result)
	return nil
}

func mongoOpReplaceOne(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	filter, err := mongoRawDoc(o.cmd.Filter, nil)
	if err != nil || filter == nil {
		return fmt.Errorf("replaceOne requires a valid filter")
	}
	doc, err := mongoRawDoc(o.cmd.Document, nil)
	if err != nil || doc == nil {
		return fmt.Errorf("replaceOne requires a valid document")
	}
	result, err := coll.ReplaceOne(o.ctx, filter, doc)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("document not found: it may have been deleted or its _id changed")
	}
	o.resp.RowsAffected = result.ModifiedCount
	return nil
}

func mongoOpDelete(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	filter, err := o.filterDoc()
	if err != nil {
		return err
	}
	var result *mongo.DeleteResult
	if o.op == "deleteone" {
		result, err = coll.DeleteOne(o.ctx, filter)
	} else {
		result, err = coll.DeleteMany(o.ctx, filter)
	}
	if err != nil {
		return err
	}
	o.resp.RowsAffected = result.DeletedCount
	return nil
}

func mongoOpCount(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	filter, err := o.filterDoc()
	if err != nil {
		return err
	}
	count, err := coll.CountDocuments(o.ctx, filter)
	if err != nil {
		return err
	}
	o.setCount(count)
	return nil
}

func mongoOpEstimatedCount(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	count, err := coll.EstimatedDocumentCount(o.ctx)
	if err != nil {
		return err
	}
	o.setCount(count)
	return nil
}

func mongoOpListCollections(o *mongoOpCtx) error {
	names, err := o.db.ListCollectionNames(o.ctx, bson.D{})
	if err != nil {
		return err
	}
	o.setNames("collection", names)
	return nil
}

func mongoOpListDatabases(o *mongoOpCtx) error {
	names, err := o.client.ListDatabaseNames(o.ctx, bson.D{})
	if err != nil {
		return err
	}
	o.setNames("database", names)
	return nil
}

func mongoOpCreateCollection(o *mongoOpCtx) error {
	if o.collectionName == "" {
		return fmt.Errorf("createCollection requires collection")
	}
	if err := o.db.CreateCollection(o.ctx, o.collectionName); err != nil {
		return err
	}
	o.resp.RowsAffected = 1
	return nil
}

func mongoOpDropCollection(o *mongoOpCtx) error {
	coll, err := o.collection()
	if err != nil {
		return err
	}
	if err := coll.Drop(o.ctx); err != nil {
		return err
	}
	o.resp.RowsAffected = 1
	return nil
}

func mongoOpDropDatabase(o *mongoOpCtx) error {
	if err := o.db.Drop(o.ctx); err != nil {
		return err
	}
	o.resp.RowsAffected = 1
	return nil
}

func mongoOpRunCommand(o *mongoOpCtx) error {
	command, err := mongoRawDoc(o.cmd.Command, nil)
	if err != nil {
		return fmt.Errorf("invalid command: %w", err)
	}
	var out bson.Raw
	if err := o.db.RunCommand(o.ctx, command).Decode(&out); err != nil {
		return err
	}
	if o.cmd.Canonical {
		ext, err := bson.MarshalExtJSON(out, true, false)
		if err != nil {
			return err
		}
		o.resp.Documents = []jsonv1.RawMessage{ext}
		return nil
	}
	row := mongoDocToMap(out)
	o.resp.Columns = columnsFromRows([]map[string]any{row})
	o.resp.Rows = []map[string]any{row}
	return nil
}

// mongoQueryLimit applies the request/command limit with the 200 default and 5000 cap.
func mongoQueryLimit(reqLimit int, cmdLimit int64) int64 {
	limit := int64(reqLimit)
	if cmdLimit > 0 {
		limit = cmdLimit
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	return limit
}

// mongoOpenTarget returns the client/database for the request, plus a cleanup func.
func mongoOpenTarget(ctx context.Context, req dbQueryRequest, cmd mongoQueryCommand) (*mongo.Client, *mongo.Database, func(), error) {
	var client *mongo.Client
	var db *mongo.Database
	cleanup := func() {}
	if req.handle != nil {
		client, db = req.handle.mongo, req.handle.mongoDB
	} else {
		var err error
		client, db, err = openMongoDatabase(ctx, req.Connection)
		if err != nil {
			return nil, nil, nil, err
		}
		cleanup = func() { _ = client.Disconnect(context.Background()) }
	}
	if name := strings.TrimSpace(cmd.Database); name != "" {
		db = client.Database(name)
	}
	return client, db, cleanup, nil
}
