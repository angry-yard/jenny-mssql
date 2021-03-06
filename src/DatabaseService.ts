﻿import * as sql from "mssql";
import * as Promise from "bluebird";
import * as _ from "underscore";
import {IDatabaseService} from "jenny-database/interfaces/IDatabaseService";
import {IForeignKeyResponse} from "jenny-database/interfaces/IForeignKeyResponse";
import {ITableResponse} from "jenny-database/interfaces/ITableResponse";
import {IPrimaryKeyResponse} from "jenny-database/interfaces/IPrimaryKeyResponse";
import {Table} from "jenny-database/Table";
import {Column} from "jenny-database/Column";
import {Queries} from "./Queries";

export class DatabaseService implements IDatabaseService {
    private sqlConfig: sql.config;

    constructor(user: string, password: string, server: string, database: string, private includedTables?: string[], private excludedTables?: string[]) {
        this.sqlConfig = {
            user: user,
            password: password,
            server: server,
            database: database
        }
    }

    populateTables = (): Promise<Array<Table>> => {
        var connection = new sql.Connection(this.sqlConfig);
        var deferredResult = Promise.defer<Array<Table>>();

        connection
            .connect()
            .then(() => {
                console.log(`Connected to database - ${this.sqlConfig.database}`);

                this.createTables(connection)
                    .then((tables: Table[]) => {
                        Promise
                            .all([this.getPrimaryKeys(connection, tables), this.getForeignKeys(connection, tables)])
                            .then(() => {
                                deferredResult.resolve(tables);
                                connection.close();
                            })
                            .catch((error: any) => {
                                console.log(error);
                            })
                    });
            })
            .catch((error: sql.ConnectionError) => {
                console.log("Error connecting to the database");
                console.log(error.message);
                process.exit();
            });

        return deferredResult.promise;
    };

    private createTables = (connection: sql.Connection): Promise<Array<Table>> => {
        var tables: Array<Table> = [];
        var deferredResult = Promise.defer<Array<Table>>();
        var request = new sql.Request(connection);

        request
            .query<ITableResponse>(Queries.getTables(this.includedTables, this.excludedTables))
            .then((recordset: ITableResponse[]) => {
                var tableId = 0;
                var table: Table;

                _.each(recordset, (record: ITableResponse) => {
                    if (tableId !== record.table_id) {
                        // Table needs to be created
                        console.log(`Building table - ${record.table_name}`);

                        table = new Table(record);
                        tables.push(table);

                        tableId = record.table_id;
                    }

                    // Add column
                    var column = new Column(table, record);
                    table.columns.push(column);
                });

                deferredResult.resolve(tables);
            })
            .catch((error: sql.RequestError) => {
                console.log("Error creating tables");
                console.log(error.message);
                process.exit();
            });

        return deferredResult.promise;
    };

    private getPrimaryKeys = (connection: sql.Connection, tables: Table[]): Promise<void> => {
        var deferredResult = Promise.defer<void>();
        var tableCount = 0;

        _.each(tables, (table: Table) => {
            var request = new sql.Request(connection);

            request
                .query<IPrimaryKeyResponse>(Queries.getPrimaryKeys())
                .then((recordset: IPrimaryKeyResponse[]) => {
                    tableCount++;

                    _.each(recordset, (record: IPrimaryKeyResponse) => {
                        var table = _.findWhere(tables, {id: record.table_id});

                        if (table) {
                            var column = _.findWhere(table.columns, {id: record.column_id});

                            if (column) {
                                column.isPrimaryKey = true;
                            }
                        }
                    });

                    if (tableCount === tables.length) {
                        deferredResult.resolve();
                    }
                })
                .catch((error: sql.RequestError) => {
                    console.log("Error getting primary keys");
                    console.log(error.message);
                    process.exit();
                });
        });

        return deferredResult.promise;
    };

    private getForeignKeys = (connection: sql.Connection, tables: Table[]): Promise<void> => {
        var deferredResult = Promise.defer<void>();
        var tableCount = 0;

        _.each(tables, (table: Table) => {
            var request = new sql.Request(connection);

            request
                .query<IForeignKeyResponse>(Queries.getForeignKeys(table.id))
                .then((recordset: IForeignKeyResponse[]) => {
                    tableCount++;

                    _.each(recordset, (record: IForeignKeyResponse) => {
                        if (recordset) {
                            var referencedTable = _.findWhere(tables, {id: record.referenced_object_id});

                            if (!table) {
                                console.log("There was an error finding the table");
                            } else {
                                var referencedColumn = _.findWhere(referencedTable.columns, {id: record.referenced_column_id});
                                var column = _.findWhere(table.columns, {id: record.parent_column_id});

                                if (column) {
                                    column.isForeignKey = true;
                                    column.foreignKey = referencedColumn;

                                    // Add the inverse relationship to find all uses of primary key
                                    referencedColumn.childKeys.push(column);
                                }
                            }
                        }
                    });

                    if (tableCount === tables.length) {
                        deferredResult.resolve();
                    }
                })
                .catch((error: sql.RequestError) => {
                    console.log("Error getting foreign keys");
                    console.log(error.message);
                    process.exit();
                });
        });

        return deferredResult.promise;
    };
}